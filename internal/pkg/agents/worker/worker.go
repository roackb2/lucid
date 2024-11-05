package worker

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/looplab/fsm"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/tools"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

const (
	TickerInterval      = 500 * time.Millisecond
	WorkerControlChSize = 10
	PublishTimeout      = 5 * time.Second
)

type WorkerImpl struct {
	chatProvider providers.ChatProvider `json:"-"`
	storage      storage.Storage        `json:"-"`
	stateMachine *fsm.FSM               `json:"-"` // FSM already implements mutex
	controlCh    chan string            `json:"-"`
	callbacks    WorkerCallbacks        `json:"-"`
	messageMux   sync.RWMutex           `json:"-"`
	persistTools *tools.PersistTool     `json:"-"`
	flowTools    *tools.FlowTool        `json:"-"`
	pubSub       pubsub.PubSub          `json:"-"`

	ID       *string                 `json:"id"`
	Role     string                  `json:"role"`
	Messages []providers.ChatMessage `json:"messages"`
}

func NewWorker(id *string, role string, storage storage.Storage, chatProvider providers.ChatProvider, pubSub pubsub.PubSub) *WorkerImpl {
	persistTool := tools.NewPersistTool(storage)
	flowTool := tools.NewFlowTool()

	return &WorkerImpl{
		chatProvider: chatProvider,
		storage:      storage,
		stateMachine: nil, // Should init when start or resume task
		controlCh:    make(chan string, WorkerControlChSize),
		messageMux:   sync.RWMutex{},
		persistTools: persistTool,
		flowTools:    flowTool,
		pubSub:       pubSub,

		ID:   id,
		Role: role,
	}
}

// For testing purposes
func (w *WorkerImpl) SetControlCh(ch chan string) {
	w.controlCh = ch
}

func (w *WorkerImpl) atomicGetMessages() []providers.ChatMessage {
	w.messageMux.RLock()
	defer w.messageMux.RUnlock()
	messagesCopy := make([]providers.ChatMessage, len(w.Messages))
	copy(messagesCopy, w.Messages)
	return messagesCopy
}

func (w *WorkerImpl) atomicAppendMessage(msg providers.ChatMessage) {
	w.messageMux.Lock()
	defer w.messageMux.Unlock()
	w.Messages = append(w.Messages, msg)
}

func (w *WorkerImpl) atomicAppendMessages(msgs []providers.ChatMessage) {
	w.messageMux.Lock()
	defer w.messageMux.Unlock()
	w.Messages = append(w.Messages, msgs...)
}

func (w *WorkerImpl) GetStatus() string {
	if w.stateMachine == nil {
		return StatusTerminated
	}
	return w.stateMachine.Current()
}

func (w *WorkerImpl) GetRole() string {
	return w.Role
}

func (w *WorkerImpl) Close() {
	slog.Info("Worker: Closing control channel", "agentID", *w.ID, "role", w.Role)
}

func (w *WorkerImpl) initChat(messages []providers.ChatMessage, callbacks WorkerCallbacks) {
	w.callbacks = callbacks
	w.initAgentStateMachine()
	w.atomicAppendMessages(messages)
}

func (w *WorkerImpl) Chat(
	ctx context.Context,
	prompt string,
	callbacks WorkerCallbacks,
) (string, error) {
	messages := []providers.ChatMessage{
		{
			Content: &SystemPrompt,
			Role:    "system",
		},
		{
			Content: &prompt,
			Role:    "user",
		},
	}
	w.initChat(messages, callbacks)
	// Save initial state
	if err := w.PersistState(); err != nil {
		slog.Error("Worker: Failed to persist state", "error", err)
	}
	return w.getAgentResponseWithFlowControl(ctx)
}

func (w *WorkerImpl) ResumeChat(
	ctx context.Context,
	newPrompt *string,
	callbacks WorkerCallbacks,
) (string, error) {
	messages := []providers.ChatMessage{
		{
			Content: newPrompt,
			Role:    "user",
		},
	}
	w.initChat(messages, callbacks)
	// Save initial state after resume
	if err := w.PersistState(); err != nil {
		slog.Error("Worker: Failed to persist state", "error", err)
	}
	return w.getAgentResponseWithFlowControl(ctx)
}

func (w *WorkerImpl) getAgentResponseWithFlowControl(ctx context.Context) (string, error) {
	if w.controlCh == nil {
		slog.Error("Worker: Control channel not initialized", "agentID", *w.ID, "role", w.Role)
		return "", fmt.Errorf("control channel not initialized")
	}

	ticker := time.NewTicker(TickerInterval)
	defer ticker.Stop()

	for {
		slog.Info("Worker: waiting for command or ticker")
		select {
		case <-ctx.Done():
			slog.Info("Worker: context done")
			return "", ctx.Err()
		case cmd, ok := <-w.controlCh:
			if !ok {
				slog.Error("Worker: control channel closed")
				return "", fmt.Errorf("control channel closed")
			}
			slog.Info("Worker: received command", "command", cmd)
			if err := w.stateMachine.Event(context.Background(), cmd); err != nil {
				slog.Error("Error processing event", "error", err)
			}
		case <-ticker.C:
			status := w.GetStatus()
			slog.Info("Worker: current state", "agentID", *w.ID, "role", w.Role, "state", status)
			switch status {
			case StatusRunning:
				if response := w.getAgentResponse(); response != "" {
					if err := w.publishFinalResponse(ctx, response); err != nil {
						slog.Error("Worker: Failed to publish final response", "error", err)
					}
					// We got the final response, persist state and terminate the agent
					w.stateMachine.SetState(StatusTerminated)
					w.cleanUp()
					return response, nil
				}
			case StatusPaused:
				// Do nothing; the ticker handles pacing
			case StatusAsleep:
				return "", nil
			case StatusTerminated:
				return "", nil
			}
		}
	}
}

// SendCommand is idempotent, it will have no effect if the Worker is asleep or terminated.
func (w *WorkerImpl) SendCommand(ctx context.Context, command string) error {
	if w.controlCh == nil {
		slog.Error("Worker: Control channel not initialized", "agentID", *w.ID, "role", w.Role)
		return fmt.Errorf("control channel not initialized")
	}
	status := w.GetStatus()
	if status == StatusAsleep || status == StatusTerminated {
		slog.Warn("Worker: Agent is asleep or terminated, ignore send command", "agentID", *w.ID, "role", w.Role, "command", command)
		return nil
	}
	select {
	case w.controlCh <- command:
		slog.Info("Worker: Sent command", "agentID", *w.ID, "role", w.Role, "command", command)
		return nil
	case <-ctx.Done():
		return fmt.Errorf("context canceled, cannot send command")
	case <-time.After(3 * TickerInterval): // Make sure we have time to send the command
		return fmt.Errorf("sending command timed out")
	}
}

func (w *WorkerImpl) initAgentStateMachine() {
	w.stateMachine = fsm.NewFSM(
		"running",
		fsm.Events{
			{Name: CmdPause, Src: []string{StatusRunning}, Dst: StatusPaused},
			{Name: CmdResume, Src: []string{StatusPaused}, Dst: StatusRunning},
			{Name: CmdSleep, Src: []string{StatusRunning, StatusPaused, StatusAsleep}, Dst: StatusAsleep},
			{Name: CmdTerminate, Src: []string{StatusRunning, StatusPaused}, Dst: StatusTerminated},
		},
		fsm.Callbacks{
			"before_event": func(_ context.Context, e *fsm.Event) {
				slog.Info("Before event", "from", e.Src, "to", e.Dst)
			},
			"enter_state": func(_ context.Context, e *fsm.Event) {
				slog.Info("Transitioned to state", "from", e.Src, "to", e.Dst)
			},
			"after_pause": func(_ context.Context, e *fsm.Event) {
				if callback, ok := w.callbacks[OnPause]; ok {
					callback(*w.ID, w.stateMachine.Current())
				}
			},
			"after_resume": func(_ context.Context, e *fsm.Event) {
				if callback, ok := w.callbacks[OnResume]; ok {
					callback(*w.ID, w.stateMachine.Current())
				}
			},
			"after_sleep": func(_ context.Context, e *fsm.Event) {
				if callback, ok := w.callbacks[OnSleep]; ok {
					callback(*w.ID, w.stateMachine.Current())
				}
				w.cleanUp()
			},
			"after_terminate": func(_ context.Context, e *fsm.Event) {
				if callback, ok := w.callbacks[OnTerminate]; ok {
					callback(*w.ID, w.stateMachine.Current())
				}
				w.cleanUp()
			},
		},
	)
}

func (w *WorkerImpl) cleanUp() {
	if err := w.PersistState(); err != nil {
		slog.Error("Worker: Failed to persist state", "error", err)
	}
	slog.Info("Worker: Cleaned up", "agentID", *w.ID, "role", w.Role)
}

func (w *WorkerImpl) getAgentResponse() string {
	// Ask the LLM
	messages := w.atomicGetMessages()
	agentResponse, err := w.chatProvider.Chat(messages)
	if err != nil {
		slog.Error("Agent chat error", "role", w.Role, "error", err)
		return ""
	}
	msg := providers.ChatMessage{
		Content: agentResponse.Content,
		Role:    "assistant",
	}
	if len(agentResponse.ToolCalls) > 0 {
		msg.ToolCall = &agentResponse.ToolCalls[0]
	}
	w.atomicAppendMessage(msg)

	// Handle tool calls
	finalResponse := w.handleToolCalls(agentResponse.ToolCalls)
	slog.Info("Agent final response", "role", w.Role, "response", finalResponse)

	messages = w.atomicGetMessages()
	w.debugStruct("Agent chat messages", messages)

	return finalResponse
}

func (w *WorkerImpl) handleToolCalls(
	toolCalls []providers.ToolCall,
) (finalResponse string) {
	for _, toolCall := range toolCalls {
		funcName := toolCall.FunctionName
		slog.Info("Agent tool call", "role", w.Role, "tool_call", funcName)

		toolCallResult := w.handleSingleToolCall(toolCall)
		slog.Info("Agent tool message", "role", w.Role, "message", toolCallResult)

		if funcName == "report" {
			finalResponse = toolCallResult
			break
		}
	}

	return finalResponse
}

func (w *WorkerImpl) handleSingleToolCall(
	toolCall providers.ToolCall,
) (toolCallResult string) {
	funcName := toolCall.FunctionName
	slog.Info("Agent tool call", "role", w.Role, "tool_call", funcName)

	toolCallFuncMap := map[string]func(toolCall providers.ToolCall) string{
		"save_content":   w.persistTools.SaveContent,
		"search_content": w.persistTools.SearchContent,
		"wait":           w.flowTools.Wait,
		"report":         w.flowTools.Report,
	}
	toolCallResult = toolCallFuncMap[funcName](toolCall)
	w.atomicAppendMessage(providers.ChatMessage{
		Content:  &toolCallResult,
		Role:     "tool",
		ToolCall: &toolCall,
	})

	return toolCallResult
}

func (w *WorkerImpl) debugStruct(title string, v any) {
	slog.Info(title, "role", w.Role)
	utils.PrintStruct(v)
}
