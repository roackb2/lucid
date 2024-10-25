package foundation

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/tools"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

const (
	SleepInterval = 1 * time.Second
)

type FoundationModelImpl struct {
	client  *openai.Client
	storage storage.Storage

	ID           *string                                  `json:"id,required"`
	Role         string                                   `json:"role,required"`
	Model        openai.ChatModel                         `json:"model,required"`
	Messages     []openai.ChatCompletionMessageParamUnion `json:"messages,required"`
	PersistTools *tools.PersistTool
	FlowTools    *tools.FlowTool
}

func NewFoundationModel(id *string, role string, storage storage.Storage) FoundationModel {
	client := openai.NewClient(
		option.WithAPIKey(config.Config.OpenAI.APIKey),
	)
	persistTool := tools.NewPersistTool(storage)
	flowTool := tools.NewFlowTool()
	return &FoundationModelImpl{
		client:  client,
		storage: storage,

		ID:           id,
		Role:         role,
		Model:        openai.ChatModelGPT4o,
		PersistTools: persistTool,
		FlowTools:    flowTool,
	}
}

func (f *FoundationModelImpl) assembleChatParams() openai.ChatCompletionNewParams {
	tools := append(f.PersistTools.GetToolDefinition(), f.FlowTools.GetToolDefinition()...)
	return openai.ChatCompletionNewParams{
		Messages: openai.F(f.Messages),
		Tools:    openai.F(tools),
		Model:    openai.F(f.Model),
	}
}

func (f *FoundationModelImpl) chatCompletion(ctx context.Context) (*openai.ChatCompletionMessage, error) {
	chatParams := f.assembleChatParams()
	f.debugStruct("Agent chat params messages", chatParams.Messages)

	chatCompletion, err := f.client.Chat.Completions.New(ctx, chatParams)
	if err != nil {
		slog.Error("Agent chat error", "role", f.Role, "error", err)
		return nil, err
	}
	agentResponse := chatCompletion.Choices[0].Message
	f.Messages = append(f.Messages, agentResponse)

	f.debugStruct("Agent chat completion", chatCompletion)
	return &agentResponse, nil
}

func (f *FoundationModelImpl) Chat(prompt string) (string, error) {
	ctx := context.Background()
	f.Messages = []openai.ChatCompletionMessageParamUnion{
		openai.SystemMessage(SystemPrompt),
		openai.UserMessage(prompt),
	}
	return f.getAgentResponse(ctx)
}

func (f *FoundationModelImpl) ResumeChat(newPrompt *string) (string, error) {
	ctx := context.Background()
	if newPrompt != nil {
		f.Messages = append(f.Messages, openai.UserMessage(*newPrompt))
	}
	return f.getAgentResponse(ctx)
}

func (f *FoundationModelImpl) getAgentResponse(ctx context.Context) (string, error) {
	// Loop until the LLM returns a non-empty finalResponse
	finalResponse := ""
	for finalResponse == "" {
		f.debugStruct("Agent chat messages", f.Messages)

		// Ask the LLM
		agentResponse, err := f.chatCompletion(ctx)
		if err != nil {
			slog.Error("Agent chat error", "role", f.Role, "error", err)
			return "", err
		}

		// Handle tool calls
		finalResponse = f.handleToolCalls(ctx, agentResponse.ToolCalls)
		time.Sleep(SleepInterval)
	}

	return finalResponse, nil
}

func (f *FoundationModelImpl) handleToolCalls(
	ctx context.Context,
	toolCalls []openai.ChatCompletionMessageToolCall,
) (finalResponse string) {
	for _, toolCall := range toolCalls {
		funcName := toolCall.Function.Name
		slog.Info("Agent tool call", "role", f.Role, "tool_call", funcName)

		toolCallResult := f.handleSingleToolCall(ctx, toolCall)
		slog.Info("Agent tool message", "role", f.Role, "message", toolCallResult)
		f.Messages = append(f.Messages, openai.ToolMessage(toolCall.ID, toolCallResult))

		if funcName == "report" {
			finalResponse = toolCallResult
			break
		}
	}

	return finalResponse
}

func (f *FoundationModelImpl) handleSingleToolCall(
	ctx context.Context,
	toolCall openai.ChatCompletionMessageToolCall,
) (toolCallResult string) {
	funcName := toolCall.Function.Name
	slog.Info("Agent tool call", "role", f.Role, "tool_call", funcName)

	funcCallMap := map[string]func(ctx context.Context, toolCall openai.ChatCompletionMessageToolCall) string{
		"save_content":   f.PersistTools.SaveContent,
		"search_content": f.PersistTools.SearchContent,
		"wait":           f.FlowTools.Wait,
		"report":         f.FlowTools.Report,
	}
	toolCallResult = funcCallMap[funcName](ctx, toolCall)

	return toolCallResult
}

func (f *FoundationModelImpl) Serialize() ([]byte, error) {
	data, err := json.Marshal(f)
	if err != nil {
		slog.Error("FoundationModelImpl: Failed to serialize", "error", err)
		return nil, err
	}
	return data, nil
}

func (f *FoundationModelImpl) Deserialize(data []byte) error {
	content := string(data)
	slog.Info("Deserializing FoundationModelImpl", "content", content)

	var jsonMap map[string]any
	err := json.Unmarshal(data, &jsonMap)
	if err != nil {
		slog.Error("FoundationModelImpl: Failed to deserialize", "error", err)
		return err
	}
	slog.Info("Deserialized FoundationModelImpl", "jsonMap", jsonMap)

	err = f.rebuildFromJsonMap(jsonMap)
	if err != nil {
		slog.Error("FoundationModelImpl: Failed to rebuild from jsonMap", "error", err)
		return err
	}

	return nil
}

func (f *FoundationModelImpl) rebuildFromJsonMap(jsonMap map[string]any) error {
	for key, value := range jsonMap {
		switch key {
		case "id":
			id := value.(string)
			f.ID = &id
		case "role":
			f.Role = value.(string)
		case "model":
			f.Model = value.(openai.ChatModel)
		case "messages":
			for _, message := range value.([]any) {
				msg := message.(map[string]any)
				role := msg["role"].(string)
				f.rebuildContentMessage(msg, role)
				f.rebuildToolCalls(msg)
			}
		}
	}

	f.debugStruct("Rebuilt FoundationModelImpl", f)

	return nil
}

func (f *FoundationModelImpl) rebuildContentMessage(msg map[string]any, role string) {
	content, ok := msg["content"]
	if !ok {
		return
	}
	if len(content.([]any)) == 0 {
		return
	}
	firstContent := content.([]any)[0]
	text := firstContent.(map[string]any)["text"].(string)
	switch role {
	case "system":
		f.Messages = append(f.Messages, openai.SystemMessage(text))
	case "user":
		f.Messages = append(f.Messages, openai.UserMessage(text))
	case "assistant":
		f.Messages = append(f.Messages, openai.AssistantMessage(text))
	case "tool":
		id := msg["tool_call_id"].(string)
		f.Messages = append(f.Messages, openai.ToolMessage(id, text))
	}
}

func (f *FoundationModelImpl) rebuildToolCalls(msg map[string]any) []openai.ChatCompletionMessageToolCallParam {
	toolCalls, ok := msg["tool_calls"]
	if !ok || toolCalls == nil {
		return nil
	}
	slog.Info("Tool calls", "tool_calls", toolCalls)
	restoredToolCalls := []openai.ChatCompletionMessageToolCallParam{}
	for _, toolCall := range toolCalls.([]any) {
		toolCall := toolCall.(map[string]any)
		id := toolCall["id"].(string)
		function := toolCall["function"].(map[string]any)
		restoredToolCall := openai.ChatCompletionMessageToolCallParam{
			ID:   openai.F(id),
			Type: openai.F(openai.ChatCompletionMessageToolCallTypeFunction),
			Function: openai.F(openai.ChatCompletionMessageToolCallFunctionParam{
				Name:      openai.F(function["name"].(string)),
				Arguments: openai.F(function["arguments"].(string)),
			}),
		}
		restoredToolCalls = append(restoredToolCalls, restoredToolCall)
	}
	restoredToolCallMsg := openai.ChatCompletionAssistantMessageParam{
		Role:      openai.F(openai.ChatCompletionAssistantMessageParamRoleAssistant),
		ToolCalls: openai.F(restoredToolCalls),
	}
	f.Messages = append(f.Messages, restoredToolCallMsg)
	return restoredToolCalls
}

func (f *FoundationModelImpl) debugStruct(title string, v any) {
	slog.Info(title, "role", f.Role)
	utils.PrintStruct(v)
}
