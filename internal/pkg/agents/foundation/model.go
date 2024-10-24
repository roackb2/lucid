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
	id         *string
	role       string
	client     *openai.Client
	storage    storage.Storage
	chatParams openai.ChatCompletionNewParams
}

func NewFoundationModel(id *string, role string, storage storage.Storage) FoundationModel {
	client := openai.NewClient(
		option.WithAPIKey(config.Config.OpenAI.APIKey),
	)
	return &FoundationModelImpl{
		id:      id,
		role:    role,
		client:  client,
		storage: storage,
	}
}

func (f *FoundationModelImpl) Chat(prompt string) (string, error) {
	ctx := context.Background()

	persistTool := tools.NewPersistTool(f.storage)
	flowTool := tools.NewFlowTool()
	tools := append(persistTool.GetToolDefinition(), flowTool.GetToolDefinition()...)

	f.chatParams = openai.ChatCompletionNewParams{
		Messages: openai.F([]openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(SystemPrompt),
			openai.UserMessage(prompt),
		}),
		Tools: openai.F(tools),
		Model: openai.F(openai.ChatModelGPT4o),
	}

	for true {
		f.debugStruct("Agent chat messages", f.chatParams.Messages.Value)

		// Ask the LLM
		chatCompletion, err := f.client.Chat.Completions.New(ctx, f.chatParams)
		if err != nil {
			slog.Error("Agent chat error", "role", f.role, "error", err)
			return "", err
		}
		agentResponse := chatCompletion.Choices[0].Message
		f.chatParams.Messages.Value = append(f.chatParams.Messages.Value, agentResponse)

		f.debugStruct("Agent chat completion", chatCompletion)

		// Handle tool calls
		for _, toolCall := range agentResponse.ToolCalls {
			funcName := toolCall.Function.Name
			slog.Info("Agent tool call", "role", f.role, "tool_call", funcName)

			toolCallResult := ""
			switch funcName {
			case "save_content":
				err = persistTool.SaveContent(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", f.role, "tool_call", funcName, "error", err)
					toolCallResult = fmt.Sprintf("Error: %v", err)
				} else {
					toolCallResult = "Content saved successfully."
				}
			case "search_content":
				toolRes, err := persistTool.SearchContent(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", f.role, "tool_call", funcName, "error", err)
					toolCallResult = fmt.Sprintf("Error: %v", err)
				} else {
					toolCallResult = fmt.Sprintf("Results Found (separated by comma): %v", strings.Join(toolRes, ", "))
				}
			case "wait":
				// We currently don't actually wait for the given duration,
				// just cheat the LLM by saying we're waiting to let it continue the task.
				duration, err := flowTool.Wait(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", f.role, "tool_call", funcName, "error", err)
					toolCallResult = fmt.Sprintf("Error: %v", err)
				} else {
					toolCallResult = fmt.Sprintf("Waiting for %f seconds before continuing the task", duration)
				}
			case "report":
				slog.Info("Agent report tool call", "role", f.role, "tool_call", funcName)
				toolMsgContent, err := flowTool.Report(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", f.role, "tool_call", funcName, "error", err)
					toolMsgContent = fmt.Sprintf("Error: %v", err)
				}
				return toolMsgContent, nil
			}
			slog.Info("Agent tool message", "role", f.role, "message", toolCallResult)
			f.chatParams.Messages.Value = append(f.chatParams.Messages.Value, openai.ToolMessage(toolCall.ID, toolCallResult))
		}
	}

	time.Sleep(SleepInterval)

	return "", nil
}

func (f *FoundationModelImpl) Serialize() string {
	data, err := json.Marshal(f)
	if err != nil {
		slog.Error("FoundationModelImpl: Failed to serialize", "error", err)
		return ""
	}
	return string(data)
}

func (f *FoundationModelImpl) Deserialize(data string) error {
	err := json.Unmarshal([]byte(data), f)
	return err
}

func (f *FoundationModelImpl) debugStruct(title string, v any) {
	slog.Info(title, "role", f.role)
	utils.PrintStruct(v)
}
