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

// const (
// 	SleepInterval = 1 * time.Second
// )

type Worker struct {
	chatProvider providers.ChatProvider
	storage      storage.Storage
	stateMachine *fsm.FSM
	messages     []providers.ChatMessage

	ID           *string `json:"id,required"`
	Role         string  `json:"role,required"`
	PersistTools *tools.PersistTool
	FlowTools    *tools.FlowTool
}

func NewWorker(id *string, role string, storage storage.Storage, chatProvider providers.ChatProvider) *Worker {
	persistTool := tools.NewPersistTool(storage)
	flowTool := tools.NewFlowTool()
	return &Worker{
		chatProvider: chatProvider,
		storage:      storage,
		stateMachine: nil, // Should init when start or resume task

		ID:           id,
		Role:         role,
		PersistTools: persistTool,
		FlowTools:    flowTool,
	}
}

func (w *Worker) Chat(prompt string, controlCh ControlReceiverCh, reportCh ReportSenderCh) (string, error) {
	w.initAgentStateMachine(reportCh)
	ctx := context.Background()
	w.messages = []providers.ChatMessage{{
		Content: &SystemPrompt,
		Role:    "system",
	}, {
		Content: &prompt,
		Role:    "user",
	}}
	return w.getAgentResponseWithFlowControl(ctx, controlCh)
}

func (w *Worker) ResumeChat(newPrompt *string, controlCh ControlReceiverCh, reportCh ReportSenderCh) (string, error) {
	w.initAgentStateMachine(reportCh)
	ctx := context.Background()
	if newPrompt != nil {
		w.messages = append(w.messages, providers.ChatMessage{
			Content: newPrompt,
			Role:    "user",
		})
	}
	return w.getAgentResponseWithFlowControl(ctx, controlCh)
}

// MARK: Pure logic without provider implementation detail
func (w *Worker) getAgentResponseWithFlowControl(ctx context.Context, controlCh ControlReceiverCh) (string, error) {
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

// MARK: Pure logic without provider implementation detail
func (w *Worker) initAgentStateMachine(reportCh ReportSenderCh) {
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

func (w *Worker) CleanUp() {
	if err := w.PersistState(); err != nil {
		slog.Error("Worker: Failed to persist state", "error", err)
	}
	slog.Info("Worker: Cleaned up", "agentID", *w.ID, "role", w.Role)
}

func (w *Worker) getAgentResponse(ctx context.Context) string {
	// Ask the LLM
	agentResponse, err := w.chatProvider.Chat(w.messages)
	if err != nil {
		slog.Error("Agent chat error", "role", w.Role, "error", err)
		return ""
	}

	// Handle tool calls
	finalResponse := w.handleToolCalls(ctx, agentResponse.ToolCalls)

	w.debugStruct("Agent chat messages", w.messages)

	time.Sleep(SleepInterval)

	return finalResponse
}

func (w *Worker) handleToolCalls(
	ctx context.Context,
	toolCalls []providers.ToolCall,
) (finalResponse string) {
	for _, toolCall := range toolCalls {
		funcName := toolCall.FunctionName
		slog.Info("Agent tool call", "role", w.Role, "tool_call", funcName)

		toolCallResult := w.handleSingleToolCall(ctx, toolCall)
		slog.Info("Agent tool message", "role", w.Role, "message", toolCallResult)
		w.messages = append(w.messages, providers.ChatMessage{
			Content: &toolCallResult,
			Role:    "assistant",
		})

		if funcName == "report" {
			finalResponse = toolCallResult
			break
		}
	}

	return finalResponse
}

func (w *Worker) handleSingleToolCall(
	ctx context.Context,
	toolCall providers.ToolCall,
) (toolCallResult string) {
	funcName := toolCall.FunctionName
	slog.Info("Agent tool call", "role", w.Role, "tool_call", funcName)

	// funcCallMap := map[string]func(ctx context.Context, toolCall providers.ToolCall) string{
	// 	"save_content":   w.PersistTools.SaveContent,
	// 	"search_content": w.PersistTools.SearchContent,
	// 	"wait":           w.FlowTools.Wait,
	// 	"report":         w.FlowTools.Report,
	// }
	toolCallFuncMap := map[string]func(ctx context.Context, toolCall providers.ToolCall) string{
		"save_content":   w.PersistTools.SaveContentForProvider,
		"search_content": w.PersistTools.SearchContentForProvider,
		"wait":           w.FlowTools.WaitForProvider,
		"report":         w.FlowTools.ReportForProvider,
	}
	toolCallResult = toolCallFuncMap[funcName](ctx, toolCall)

	return toolCallResult
}

func (w *Worker) GetStatus() string {
	if w.stateMachine == nil {
		return StateTerminated
	}
	return w.stateMachine.Current()
}

func (w *Worker) PersistState() error {
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

func (w *Worker) RestoreState(agentID string) error {
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

func (w *Worker) Serialize() ([]byte, error) {
	serializedChatProvider, err := w.chatProvider.Serialize()
	if err != nil {
		slog.Error("Worker: Failed to serialize chat provider", "error", err)
		return nil, err
	}
	state := map[string]any{
		"id":            w.ID,
		"role":          w.Role,
		"chat_provider": serializedChatProvider,
	}
	data, err := json.Marshal(state)
	if err != nil {
		slog.Error("Worker: Failed to serialize", "error", err)
		return nil, err
	}
	return data, nil
}

func (w *Worker) Deserialize(data []byte) error {
	content := string(data)
	slog.Info("Deserializing Worker", "content", content)

	var jsonMap map[string]any
	err := json.Unmarshal(data, &jsonMap)
	if err != nil {
		slog.Error("Worker: Failed to deserialize", "error", err)
		return err
	}
	slog.Info("Deserialized Worker", "jsonMap", jsonMap)

	w.ID = jsonMap["id"].(*string)
	w.Role = jsonMap["role"].(string)
	serializedChatProvider, ok := jsonMap["chat_provider"]
	if !ok {
		slog.Error("Worker: Failed to deserialize chat provider", "error", err)
		return err
	}
	err = w.chatProvider.RebuildMessagesFromJsonMap(serializedChatProvider.(map[string]any))
	if err != nil {
		slog.Error("Worker: Failed to rebuild from jsonMap", "error", err)
		return err
	}

	return nil
}

// func (w *Worker) rebuildFromJsonMap(jsonMap map[string]any) error {
// 	for key, value := range jsonMap {
// 		switch key {
// 		case "id":
// 			id := value.(string)
// 			w.ID = &id
// 		case "role":
// 			w.Role = value.(string)
// 		case "model":
// 			w.Model = value.(openai.ChatModel)
// 		case "messages":
// 			for _, message := range value.([]any) {
// 				msg := message.(map[string]any)
// 				// role := msg["role"].(string)
// 				// w.rebuildContentMessage(msg, role)
// 				// w.rebuildToolCalls(msg)
// 				w.chatProvider.RebuildMessagesFromJsonMap(msg)
// 			}
// 		}
// 	}

// 	w.debugStruct("Rebuilt Worker", w)

// 	return nil
// }

// func (w *Worker) rebuildContentMessage(msg map[string]any, role string) {
// 	content, ok := msg["content"]
// 	if !ok {
// 		return
// 	}
// 	if len(content.([]any)) == 0 {
// 		return
// 	}
// 	firstContent := content.([]any)[0]
// 	text := firstContent.(map[string]any)["text"].(string)
// 	switch role {
// 	case "system":
// 		w.chatProvider.AppendMessage(providers.ChatMessage{
// 			Content: &text,
// 			Role:    role,
// 		})
// 	case "user":
// 		w.chatProvider.AppendMessage(providers.ChatMessage{
// 			Content: &text,
// 			Role:    role,
// 		})
// 	case "assistant":
// 		w.chatProvider.AppendMessage(providers.ChatMessage{
// 			Content: &text,
// 			Role:    role,
// 		})
// 	case "tool":
// 		id := msg["tool_call_id"].(string)
// 		w.chatProvider.AppendMessage(providers.ChatMessage{
// 			Content: &text,
// 			Role:    role,
// 			ToolCall: &providers.ToolCall{
// 				ID:           id,
// 				FunctionName: funcName,
// 			},
// 		})
// 	}
// }

// func (w *Worker) rebuildToolCalls(msg map[string]any) []openai.ChatCompletionMessageToolCallParam {
// 	toolCalls, ok := msg["tool_calls"]
// 	if !ok || toolCalls == nil {
// 		return nil
// 	}
// 	slog.Info("Tool calls", "tool_calls", toolCalls)
// 	restoredToolCalls := []openai.ChatCompletionMessageToolCallParam{}
// 	for _, toolCall := range toolCalls.([]any) {
// 		toolCall := toolCall.(map[string]any)
// 		id := toolCall["id"].(string)
// 		function := toolCall["function"].(map[string]any)
// 		restoredToolCall := openai.ChatCompletionMessageToolCallParam{
// 			ID:   openai.F(id),
// 			Type: openai.F(openai.ChatCompletionMessageToolCallTypeFunction),
// 			Function: openai.F(openai.ChatCompletionMessageToolCallFunctionParam{
// 				Name:      openai.F(function["name"].(string)),
// 				Arguments: openai.F(function["arguments"].(string)),
// 			}),
// 		}
// 		restoredToolCalls = append(restoredToolCalls, restoredToolCall)
// 	}
// 	restoredToolCallMsg := openai.ChatCompletionAssistantMessageParam{
// 		Role:      openai.F(openai.ChatCompletionAssistantMessageParamRoleAssistant),
// 		ToolCalls: openai.F(restoredToolCalls),
// 	}
// 	w.Messages = append(w.Messages, restoredToolCallMsg)
// 	return restoredToolCalls
// }

func (w *Worker) debugStruct(title string, v any) {
	slog.Info(title, "role", w.Role)
	utils.PrintStruct(v)
}
