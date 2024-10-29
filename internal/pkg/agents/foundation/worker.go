package foundation

import (
	"context"
	"encoding/json"
	"log/slog"
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

		ID:           id,
		Role:         role,
		PersistTools: persistTool,
		FlowTools:    flowTool,
	}
}

func (w *WorkerImpl) Chat(prompt string, controlCh ControlReceiverCh, reportCh ReportSenderCh) (string, error) {
	w.initAgentStateMachine(reportCh)
	ctx := context.Background()
	w.Messages = []providers.ChatMessage{{
		Content: &SystemPrompt,
		Role:    "system",
	}, {
		Content: &prompt,
		Role:    "user",
	}}
	return w.getAgentResponseWithFlowControl(ctx, controlCh)
}

func (w *WorkerImpl) ResumeChat(newPrompt *string, controlCh ControlReceiverCh, reportCh ReportSenderCh) (string, error) {
	w.initAgentStateMachine(reportCh)
	ctx := context.Background()
	if newPrompt != nil {
		w.Messages = append(w.Messages, providers.ChatMessage{
			Content: newPrompt,
			Role:    "user",
		})
	}
	return w.getAgentResponseWithFlowControl(ctx, controlCh)
}

func (w *WorkerImpl) getAgentResponseWithFlowControl(ctx context.Context, controlCh ControlReceiverCh) (string, error) {
	// Loop until the LLM returns a non-empty finalResponse
	finalResponse := ""
	for finalResponse == "" && w.GetStatus() != StateTerminated {
		select {
		case cmd := <-controlCh:
			err := w.stateMachine.Event(context.Background(), cmd)
			if err != nil {
				slog.Error("Error processing event", "error", err)
			}
		default:
			slog.Info("Worker: current state", "agentID", *w.ID, "role", w.Role, "state", w.GetStatus())
			switch w.GetStatus() {
			// No need to handle StateTerminated, as it will be handled in the loop condition
			case StateRunning:
				finalResponse = w.getAgentResponse(ctx)
			case StatePaused:
				// When paused, sleep briefly to prevent tight loop
				time.Sleep(100 * time.Millisecond)
			}
		}
	}

	return finalResponse, nil
}

func (w *WorkerImpl) initAgentStateMachine(reportCh ReportSenderCh) {
	w.stateMachine = fsm.NewFSM(
		"running",
		fsm.Events{
			{Name: CmdPause, Src: []string{StateRunning}, Dst: StatePaused},
			{Name: CmdResume, Src: []string{StatePaused}, Dst: StateRunning},
			{Name: CmdTerminate, Src: []string{StateRunning, StatePaused}, Dst: StateTerminated},
		},
		fsm.Callbacks{
			"enter_state": func(_ context.Context, e *fsm.Event) {
				slog.Info("Transitioned to state", "from", e.Src, "to", e.Dst)
			},
			"after_pause": func(_ context.Context, e *fsm.Event) {
				reportCh <- StatePaused
			},
			"after_resume": func(_ context.Context, e *fsm.Event) {
				reportCh <- StateRunning
			},
			"after_terminate": func(_ context.Context, e *fsm.Event) {
				w.CleanUp()
				reportCh <- StateTerminated
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

func (w *WorkerImpl) getAgentResponse(ctx context.Context) string {
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
	w.Messages = append(w.Messages, msg)

	// Handle tool calls
	finalResponse := w.handleToolCalls(ctx, agentResponse.ToolCalls)

	w.debugStruct("Agent chat messages", w.Messages)

	time.Sleep(SleepInterval)

	return finalResponse
}

func (w *WorkerImpl) handleToolCalls(
	ctx context.Context,
	toolCalls []providers.ToolCall,
) (finalResponse string) {
	for _, toolCall := range toolCalls {
		funcName := toolCall.FunctionName
		slog.Info("Agent tool call", "role", w.Role, "tool_call", funcName)

		toolCallResult := w.handleSingleToolCall(ctx, toolCall)
		slog.Info("Agent tool message", "role", w.Role, "message", toolCallResult)

		if funcName == "report" {
			finalResponse = toolCallResult
			break
		}
	}

	return finalResponse
}

func (w *WorkerImpl) handleSingleToolCall(
	ctx context.Context,
	toolCall providers.ToolCall,
) (toolCallResult string) {
	funcName := toolCall.FunctionName
	slog.Info("Agent tool call", "role", w.Role, "tool_call", funcName)

	toolCallFuncMap := map[string]func(ctx context.Context, toolCall providers.ToolCall) string{
		"save_content":   w.PersistTools.SaveContent,
		"search_content": w.PersistTools.SearchContent,
		"wait":           w.FlowTools.Wait,
		"report":         w.FlowTools.Report,
	}
	toolCallResult = toolCallFuncMap[funcName](ctx, toolCall)
	w.Messages = append(w.Messages, providers.ChatMessage{
		Content:  &toolCallResult,
		Role:     "tool",
		ToolCall: &toolCall,
	})

	return toolCallResult
}

func (w *WorkerImpl) GetStatus() string {
	if w.stateMachine == nil {
		return StateTerminated
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
	err = w.storage.SaveAgentState(*w.ID, state)
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
