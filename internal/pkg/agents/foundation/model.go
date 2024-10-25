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

	ID       *string                                  `json:"id,required"`
	Role     string                                   `json:"role,required"`
	Model    openai.ChatModel                         `json:"model,required"`
	Messages []openai.ChatCompletionMessageParamUnion `json:"messages,required"`
}

func NewFoundationModel(id *string, role string, storage storage.Storage) FoundationModel {
	client := openai.NewClient(
		option.WithAPIKey(config.Config.OpenAI.APIKey),
	)
	return &FoundationModelImpl{
		ID:      id,
		Role:    role,
		client:  client,
		storage: storage,
	}
}

func (f *FoundationModelImpl) chatCompletion(ctx context.Context, chatParams openai.ChatCompletionNewParams) (*openai.ChatCompletionMessage, error) {
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

	persistTool := tools.NewPersistTool(f.storage)
	flowTool := tools.NewFlowTool()
	tools := append(persistTool.GetToolDefinition(), flowTool.GetToolDefinition()...)

	f.Messages = []openai.ChatCompletionMessageParamUnion{
		openai.SystemMessage(SystemPrompt),
		openai.UserMessage(prompt),
	}
	f.Model = openai.ChatModelGPT4o
	chatParams := openai.ChatCompletionNewParams{
		Messages: openai.F(f.Messages),
		Tools:    openai.F(tools),
		Model:    openai.F(f.Model),
	}

	// Loop until the LLM returns a non-empty finalResponse
	finalResponse := ""
	for finalResponse == "" {
		f.debugStruct("Agent chat messages", f.Messages)

		// Ask the LLM
		agentResponse, err := f.chatCompletion(ctx, chatParams)
		if err != nil {
			slog.Error("Agent chat error", "role", f.Role, "error", err)
			return "", err
		}

		// Handle tool calls
		finalResponse = f.handleToolCalls(ctx, persistTool, flowTool, agentResponse.ToolCalls, &chatParams)
		time.Sleep(SleepInterval)
	}

	return finalResponse, nil
}

func (f *FoundationModelImpl) handleToolCalls(
	ctx context.Context,
	persistTool *tools.PersistTool,
	flowTool *tools.FlowTool,
	toolCalls []openai.ChatCompletionMessageToolCall,
	chatParams *openai.ChatCompletionNewParams,
) (finalResponse string) {
	for _, toolCall := range toolCalls {
		funcName := toolCall.Function.Name
		slog.Info("Agent tool call", "role", f.Role, "tool_call", funcName)

		toolCallResult := f.handleSingleToolCall(ctx, persistTool, flowTool, toolCall)
		slog.Info("Agent tool message", "role", f.Role, "message", toolCallResult)
		f.Messages = append(f.Messages, openai.ToolMessage(toolCall.ID, toolCallResult))
		chatParams.Messages = openai.F(f.Messages)

		if funcName == "report" {
			finalResponse = toolCallResult
			break
		}
	}

	return finalResponse
}

func (f *FoundationModelImpl) handleSingleToolCall(
	ctx context.Context,
	persistTool *tools.PersistTool,
	flowTool *tools.FlowTool,
	toolCall openai.ChatCompletionMessageToolCall,
) (toolCallResult string) {
	funcName := toolCall.Function.Name
	slog.Info("Agent tool call", "role", f.Role, "tool_call", funcName)

	funcCallMap := map[string]func(ctx context.Context, toolCall openai.ChatCompletionMessageToolCall) string{
		"save_content":   persistTool.SaveContent,
		"search_content": persistTool.SearchContent,
		"wait":           flowTool.Wait,
		"report":         flowTool.Report,
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
		slog.Info("Key", "key", key, "value", value)
		switch key {
		case "id":
			slog.Info("ID", "id", value)
			id := value.(string)
			f.ID = &id
		case "role":
			slog.Info("Role", "role", value)
			f.Role = value.(string)
		case "model":
			slog.Info("Model", "model", value)
			f.Model = value.(openai.ChatModel)
		case "messages":
			for _, message := range value.([]any) {
				msg := message.(map[string]any)
				slog.Info("Message", "message", len(msg))
				role := msg["role"].(string)
				slog.Info("Message role", "role", role)
				content, ok := msg["content"]
				if !ok {
					continue
				}
				slog.Info("Message content", "content", content)
				if len(content.([]any)) == 0 {
					slog.Info("Message content is empty", "message", msg)
					continue
				}
				firstContent := content.([]any)[0]
				slog.Info("Message first content", "firstContent", firstContent)
				text := firstContent.(map[string]any)["text"].(string)
				slog.Info("Message text", "text", text)
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
		}
	}

	// -- debug --
	data, err := json.Marshal(f)
	if err != nil {
		slog.Error("FoundationModelImpl: Failed to serialize", "error", err)
		return err
	}
	slog.Info("Rebuilt FoundationModelImpl", "data", string(data))
	// -- end of debug --

	return nil
}

func (f *FoundationModelImpl) debugStruct(title string, v any) {
	slog.Info(title, "role", f.Role)
	utils.PrintStruct(v)
}
