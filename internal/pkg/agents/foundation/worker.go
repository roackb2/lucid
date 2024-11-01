package foundation

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
	onPause      CommandCallback
	onResume     CommandCallback
	onTerminate  CommandCallback

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

func (w *WorkerImpl) Chat(
	ctx context.Context,
	prompt string,
	onPause CommandCallback,
	onResume CommandCallback,
	onTerminate CommandCallback,
) (string, error) {
	w.onPause = onPause
	w.onResume = onResume
	w.onTerminate = onTerminate
	w.initAgentStateMachine()
	w.Messages = []providers.ChatMessage{{
		Content: &SystemPrompt,
		Role:    "system",
	}, {
		Content: &prompt,
		Role:    "user",
	}}
	return w.getAgentResponseWithFlowControl(ctx)
}

func (w *WorkerImpl) ResumeChat(
	ctx context.Context,
	newPrompt *string,
	onPause CommandCallback,
	onResume CommandCallback,
	onTerminate CommandCallback,
) (string, error) {
	w.onPause = onPause
	w.onResume = onResume
	w.onTerminate = onTerminate
	w.initAgentStateMachine()
	if newPrompt != nil {
		w.appendMessage(providers.ChatMessage{
			Content: newPrompt,
			Role:    "user",
		})
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
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-ticker.C:
			select {
			case cmd := <-w.controlCh:
				w.stateMachineMux.Lock()
				err := w.stateMachine.Event(context.Background(), cmd)
				w.stateMachineMux.Unlock()
				if err != nil {
					slog.Error("Error processing event", "error", err)
				}
			default:
				slog.Info("Worker: current state", "agentID", *w.ID, "role", w.Role, "state", w.GetStatus())
				switch w.GetStatus() {
				case StatusRunning:
					if response := w.getAgentResponse(); response != "" {
						return response, nil
					}
				case StatusPaused:
					// Do nothing; the ticker handles pacing
				case StatusTerminated:
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
			{Name: CmdTerminate, Src: []string{StatusRunning, StatusPaused}, Dst: StatusTerminated},
		},
		fsm.Callbacks{
			"enter_state": func(_ context.Context, e *fsm.Event) {
				slog.Info("Transitioned to state", "from", e.Src, "to", e.Dst)
			},
			"after_pause": func(_ context.Context, e *fsm.Event) {
				if w.onPause != nil {
					w.onPause(StatusPaused)
				}
			},
			"after_resume": func(_ context.Context, e *fsm.Event) {
				if w.onResume != nil {
					w.onResume(StatusRunning)
				}
			},
			"after_terminate": func(_ context.Context, e *fsm.Event) {
				w.CleanUp()
				if w.onTerminate != nil {
					w.onTerminate(StatusTerminated)
				}
			},
		},
	)
}

func (w *WorkerImpl) CleanUp() {
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

func (w *WorkerImpl) GetStatus() string {
	w.stateMachineMux.Lock()
	defer w.stateMachineMux.Unlock()
	if w.stateMachine == nil {
		return StatusTerminated
	}
	return w.stateMachine.Current()
}

func (w *WorkerImpl) PersistState() error {
	slog.Info("Worker: Persisting state", "agentID", *w.ID, "role", w.Role)
	state, err := w.Serialize()
	if err != nil {
		slog.Error("Worker: Failed to serialize", "error", err)
		return err
	}
	now := time.Now()
	// Terminating agent and putting it to sleep
	err = w.storage.SaveAgentState(*w.ID, state, w.GetStatus(), nil, &now)
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
	err = w.storage.SaveAgentState(*w.ID, state, w.GetStatus(), &now, nil)
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
