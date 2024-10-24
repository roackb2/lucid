package foundation

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
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

	for true {
		f.debugStruct("Agent chat messages", f.Messages)

		// Ask the LLM
		chatCompletion, err := f.client.Chat.Completions.New(ctx, chatParams)
		if err != nil {
			slog.Error("Agent chat error", "role", f.Role, "error", err)
			return "", err
		}
		agentResponse := chatCompletion.Choices[0].Message
		f.Messages = append(f.Messages, agentResponse)

		f.debugStruct("Agent chat completion", chatCompletion)

		// Handle tool calls
		for _, toolCall := range agentResponse.ToolCalls {
			funcName := toolCall.Function.Name
			slog.Info("Agent tool call", "role", f.Role, "tool_call", funcName)

			toolCallResult := ""
			switch funcName {
			case "save_content":
				err = persistTool.SaveContent(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", f.Role, "tool_call", funcName, "error", err)
					toolCallResult = fmt.Sprintf("Error: %v", err)
				} else {
					toolCallResult = "Content saved successfully."
				}
			case "search_content":
				toolRes, err := persistTool.SearchContent(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", f.Role, "tool_call", funcName, "error", err)
					toolCallResult = fmt.Sprintf("Error: %v", err)
				} else {
					toolCallResult = fmt.Sprintf("Results Found (separated by comma): %v", strings.Join(toolRes, ", "))
				}
			case "wait":
				// We currently don't actually wait for the given duration,
				// just cheat the LLM by saying we're waiting to let it continue the task.
				duration, err := flowTool.Wait(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", f.Role, "tool_call", funcName, "error", err)
					toolCallResult = fmt.Sprintf("Error: %v", err)
				} else {
					toolCallResult = fmt.Sprintf("Waiting for %f seconds before continuing the task", duration)
				}
			case "report":
				slog.Info("Agent report tool call", "role", f.Role, "tool_call", funcName)
				toolMsgContent, err := flowTool.Report(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", f.Role, "tool_call", funcName, "error", err)
					toolMsgContent = fmt.Sprintf("Error: %v", err)
				}
				return toolMsgContent, nil
			}
			slog.Info("Agent tool message", "role", f.Role, "message", toolCallResult)
			f.Messages = append(f.Messages, openai.ToolMessage(toolCall.ID, toolCallResult))
			chatParams.Messages = openai.F(f.Messages)
		}
	}

	time.Sleep(SleepInterval)

	return "", nil
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
	// TODO: Instead of deserializing back to the FoundationModelImpl struct,
	// filter out the fields in jsonMap that are not needed for agents to know its previous work.

	// -- debug --
	backToJson, err := json.Marshal(jsonMap)
	if err != nil {
		slog.Error("FoundationModelImpl: Failed to serialize", "error", err)
		return err
	}
	slog.Info("Back to JSON", "backToJson", string(backToJson))
	// -- end of debug --

	return nil
}

func (f *FoundationModelImpl) debugStruct(title string, v any) {
	slog.Info(title, "role", f.Role)
	utils.PrintStruct(v)
}
