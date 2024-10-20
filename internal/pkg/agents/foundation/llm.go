package foundation

import (
	"context"
	"log/slog"
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
	role     string
	client   *openai.Client
	messages []openai.ChatCompletionMessageParamUnion
	storage  storage.Storage
}

func NewFoundationModel(role string, storage storage.Storage) FoundationModel {
	client := openai.NewClient(
		option.WithAPIKey(config.Config.OpenAI.APIKey),
	)
	return &LLM{
		role:     role,
		client:   client,
		messages: []openai.ChatCompletionMessageParamUnion{},
		storage:  storage,
	}
}

func (l *LLM) Chat(prompt string) (string, error) {
	ctx := context.Background()

	l.messages = append(l.messages, openai.SystemMessage(SystemPrompt))
	l.messages = append(l.messages, openai.UserMessage(prompt))

	persistTool := tools.NewPersistTool(l.storage)
	flowTool := tools.NewFlowTool()
	tools := append(persistTool.GetToolDefinition(), flowTool.GetToolDefinition()...)

	params := openai.ChatCompletionNewParams{
		Messages: openai.F(l.messages),
		Tools:    openai.F(tools),
		Model:    openai.F(openai.ChatModelGPT4o),
	}

	resp := ""

	for true {
		chatCompletion, err := l.client.Chat.Completions.New(ctx, params)
		if err != nil {
			return "", err
		}

		resp = chatCompletion.Choices[0].Message.Content
		slog.Info("Agent chat response", "role", l.role, "response", resp)
		for _, toolCall := range chatCompletion.Choices[0].Message.ToolCalls {
			funcName := toolCall.Function.Name
			slog.Info("Agent tool call", "role", l.role, "tool_call", funcName)
			switch funcName {
			case "save_content":
				persistTool.SaveContent(ctx, toolCall)
			case "search_content":
				persistTool.SearchContent(ctx, toolCall)
			case "done":
				return resp, nil
			}
		}
		params.Messages.Value = append(params.Messages.Value, openai.AssistantMessage(resp))

		time.Sleep(SleepInterval)
	}

	return "", nil
}

func getWeather(location string) string {
	return "The weather in " + location + " is sunny."
}
