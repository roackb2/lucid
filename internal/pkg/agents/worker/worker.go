package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/looplab/fsm"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/tools"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

const (
	SleepInterval = 1 * time.Second
)

type WorkerImpl struct {
	chatProvider providers.ChatProvider
	storage      storage.Storage
	stateMachine *fsm.FSM
	controlCh    chan string
	callbacks    WorkerCallbacks

	stateMachineMux sync.Mutex
	messageMux      sync.Mutex

	ID           *string                 `json:"id,required"`
	Role         string                  `json:"role,required"`
	Messages     []providers.ChatMessage `json:"messages"`
	PersistTools *tools.PersistTool
	FlowTools    *tools.FlowTool
}

func NewWorker(id *string, role string, storage storage.Storage, chatProvider providers.ChatProvider) *WorkerImpl {
	persistTool := tools.NewPersistTool(storage)
	flowTool := tools.NewFlowTool()

	return &WorkerImpl{
		chatProvider: chatProvider,
		storage:      storage,
		stateMachine: nil, // Should init when start or resume task
		controlCh:    make(chan string, 10),

		stateMachineMux: sync.Mutex{},
		messageMux:      sync.Mutex{},

		ID:           id,
		Role:         role,
		PersistTools: persistTool,
		FlowTools:    flowTool,
	}
}

// For testing purposes
func (w *WorkerImpl) SetControlCh(ch chan string) {
	w.controlCh = ch
}

func (w *WorkerImpl) Close() {
	close(w.controlCh)
}

func (w *WorkerImpl) Chat(
	ctx context.Context,
	prompt string,
	callbacks WorkerCallbacks,
) (string, error) {
	w.callbacks = callbacks
	w.initAgentStateMachine()
	w.Messages = []providers.ChatMessage{{
		Content: &SystemPrompt,
		Role:    "system",
	}, {
		Content: &prompt,
		Role:    "user",
	}}
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
	w.callbacks = callbacks
	w.initAgentStateMachine()
	if newPrompt != nil {
		w.appendMessage(providers.ChatMessage{
			Content: newPrompt,
			Role:    "user",
		})
	}
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

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		slog.Info("Worker: waiting for command or ticker")
		select {
		case <-ctx.Done():
			slog.Info("Worker: context done")
			return "", ctx.Err()
		case <-ticker.C:
			slog.Info("Worker: ticker")
			select {
			case cmd := <-w.controlCh:
				slog.Info("Worker: received command", "command", cmd)
				w.stateMachineMux.Lock()
				err := w.stateMachine.Event(context.Background(), cmd)
				w.stateMachineMux.Unlock()
				slog.Info("Worker: processed command", "command", cmd, "error", err)
				if err != nil {
					slog.Error("Error processing event", "error", err)
				}
			default:
				slog.Info("Worker: current state", "agentID", *w.ID, "role", w.Role, "state", w.getStatus())
				switch w.getStatus() {
				case StatusRunning:
					if response := w.getAgentResponse(); response != "" {
						return response, nil
					}
				case StatusPaused:
					// Do nothing; the ticker handles pacing
				case StatusAsleep:
					return "", nil
				}
			}
		}
	}
}

func (w *WorkerImpl) SendCommand(command string) {
	if w.controlCh == nil {
		slog.Error("Worker: Control channel not initialized", "agentID", *w.ID, "role", w.Role)
		return
	}
	w.controlCh <- command
}

func (w *WorkerImpl) initAgentStateMachine() {
	w.stateMachine = fsm.NewFSM(
		"running",
		fsm.Events{
			{Name: CmdPause, Src: []string{StatusRunning}, Dst: StatusPaused},
			{Name: CmdResume, Src: []string{StatusPaused}, Dst: StatusRunning},
			{Name: CmdSleep, Src: []string{StatusRunning, StatusPaused}, Dst: StatusAsleep},
		},
		fsm.Callbacks{
			"enter_state": func(_ context.Context, e *fsm.Event) {
				slog.Info("Transitioned to state", "from", e.Src, "to", e.Dst)
			},
			"after_pause": func(_ context.Context, e *fsm.Event) {
				if callback, ok := w.callbacks[OnPause]; ok {
					callback(*w.ID, StatusPaused)
				}
			},
			"after_resume": func(_ context.Context, e *fsm.Event) {
				if callback, ok := w.callbacks[OnResume]; ok {
					callback(*w.ID, StatusRunning)
				}
			},
			"after_sleep": func(_ context.Context, e *fsm.Event) {
				w.cleanUp()
				if callback, ok := w.callbacks[OnSleep]; ok {
					callback(*w.ID, StatusAsleep)
				}
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
	agentResponse, err := w.chatProvider.Chat(w.Messages)
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
	w.appendMessage(msg)

	// Handle tool calls
	finalResponse := w.handleToolCalls(agentResponse.ToolCalls)
	slog.Info("Agent final response", "role", w.Role, "response", finalResponse)

	w.debugStruct("Agent chat messages", w.Messages)

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
		"save_content":   w.PersistTools.SaveContent,
		"search_content": w.PersistTools.SearchContent,
		"wait":           w.FlowTools.Wait,
		"report":         w.FlowTools.Report,
	}
	toolCallResult = toolCallFuncMap[funcName](toolCall)
	w.appendMessage(providers.ChatMessage{
		Content:  &toolCallResult,
		Role:     "tool",
		ToolCall: &toolCall,
	})

	return toolCallResult
}

func (w *WorkerImpl) appendMessage(msg providers.ChatMessage) {
	w.messageMux.Lock()
	defer w.messageMux.Unlock()
	w.Messages = append(w.Messages, msg)
}

func (w *WorkerImpl) getStatus() string {
	slog.Info("Worker: Getting status", "agentID", *w.ID, "role", w.Role)
	w.stateMachineMux.Lock()
	defer w.stateMachineMux.Unlock()
	if w.stateMachine == nil {
		slog.Info("Worker: State machine is nil", "agentID", *w.ID, "role", w.Role)
		return StatusAsleep
	}
	status := w.stateMachine.Current()
	slog.Info("Worker: Got status", "agentID", *w.ID, "role", w.Role, "status", status)
	return status
}

func (w *WorkerImpl) PersistState() error {
	slog.Info("Worker: Persisting state", "agentID", *w.ID, "role", w.Role)
	state, err := w.Serialize()
	if err != nil {
		slog.Error("Worker: Failed to serialize", "error", err)
		return err
	}
	now := time.Now()
	err = w.storage.SaveAgentState(*w.ID, state, w.getStatus(), nil, &now)
	if err != nil {
		slog.Error("Worker: Failed to save state", "error", err)
		return err
	}
	return nil
}

func (w *WorkerImpl) RestoreState(agentID string) error {
	slog.Info("Worker: Restoring state", "agentID", agentID)
	state, err := w.storage.GetAgentState(agentID)
	if err != nil {
		slog.Error("Worker: Failed to get agent state", "agentID", agentID, "error", err)
		return err
	}
	err = w.Deserialize(state)
	if err != nil {
		slog.Error("Worker: Failed to deserialize state", "agentID", agentID, "error", err)
		return err
	}
	now := time.Now()
	// Awakening agent and update its status accordingly
	err = w.storage.SaveAgentState(*w.ID, state, w.getStatus(), &now, nil)
	if err != nil {
		slog.Error("Worker: Failed to save state", "error", err)
		return err
	}
	return nil
}

func (w *WorkerImpl) Serialize() ([]byte, error) {
	data, err := json.Marshal(w)
	if err != nil {
		slog.Error("Worker: Failed to serialize", "error", err)
		return nil, err
	}
	return data, nil
}

func (w *WorkerImpl) Deserialize(data []byte) error {
	content := string(data)
	slog.Info("Deserializing Worker", "content", content)

	err := json.Unmarshal(data, &w)
	if err != nil {
		slog.Error("Worker: Failed to deserialize", "error", err)
		return err
	}

	return nil
}

func (w *WorkerImpl) debugStruct(title string, v any) {
	slog.Info(title, "role", w.Role)
	utils.PrintStruct(v)
}
