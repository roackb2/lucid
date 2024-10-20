package foundation

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/tools"
)

const (
	SleepInterval = 1 * time.Second
)

type FoundationModel interface {
	Chat(prompt string) (string, error)
}

type LLM struct {
	role    string
	client  *openai.Client
	storage storage.Storage
}

func NewFoundationModel(role string, storage storage.Storage) FoundationModel {
	client := openai.NewClient(
		option.WithAPIKey(config.Config.OpenAI.APIKey),
	)
	return &LLM{
		role:    role,
		client:  client,
		storage: storage,
	}
}

func (l *LLM) Chat(prompt string) (string, error) {
	ctx := context.Background()

	persistTool := tools.NewPersistTool(l.storage)
	flowTool := tools.NewFlowTool()
	tools := append(persistTool.GetToolDefinition(), flowTool.GetToolDefinition()...)

	params := openai.ChatCompletionNewParams{
		Messages: openai.F([]openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(SystemPrompt),
			openai.UserMessage(prompt),
		}),
		Tools: openai.F(tools),
		Model: openai.F(openai.ChatModelGPT4o),
	}

	for true {
		chatCompletion, err := l.client.Chat.Completions.New(ctx, params)
		if err != nil {
			return "", err
		}

		resp := chatCompletion.Choices[0].Message.Content
		slog.Info("Agent chat response", "role", l.role, "response", resp)

		if len(chatCompletion.Choices[0].Message.ToolCalls) > 0 {
			for _, toolCall := range chatCompletion.Choices[0].Message.ToolCalls {
				funcName := toolCall.Function.Name
				slog.Info("Agent tool call", "role", l.role, "tool_call", funcName)

				assistantMsgContent := ""
				switch funcName {
				case "save_content":
					err = persistTool.SaveContent(ctx, toolCall)
					if err != nil {
						slog.Error("Agent tool call error", "role", l.role, "tool_call", funcName, "error", err)
						assistantMsgContent = fmt.Sprintf("Error: %v", err)
					} else {
						assistantMsgContent = "Content saved successfully."
					}
				case "search_content":
					toolRes, err := persistTool.SearchContent(ctx, toolCall)
					if err != nil {
						slog.Error("Agent tool call error", "role", l.role, "tool_call", funcName, "error", err)
						assistantMsgContent = fmt.Sprintf("Error: %v", err)
					} else {
						assistantMsgContent = fmt.Sprintf("Results: %v", strings.Join(toolRes, ", "))
					}
				case "done":
					slog.Info("Agent done tool call", "role", l.role, "tool_call", funcName)
					return resp, nil
				}
				slog.Info("Agent assistant message", "role", l.role, "message", assistantMsgContent)
				params.Messages.Value = append(params.Messages.Value, openai.AssistantMessage(assistantMsgContent))
			}
		} else {
			params.Messages.Value = append(params.Messages.Value, openai.AssistantMessage(resp))
		}

		slog.Info("Agent messages", "role", l.role, "messages", params.Messages.Value)

		time.Sleep(SleepInterval)
	}

	return "", nil
}

func getWeather(location string) string {
	return "The weather in " + location + " is sunny."
}
