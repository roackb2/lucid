package foundation

import (
	"context"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/tools"
)

type FoundationModel interface {
	Chat(prompt string) (string, error)
}

type LLM struct {
	client   *openai.Client
	messages []openai.ChatCompletionMessageParamUnion
	storage  storage.Storage
}

func NewFoundationModel(storage storage.Storage) FoundationModel {
	client := openai.NewClient(
		option.WithAPIKey(config.Config.OpenAI.APIKey),
	)
	return &LLM{
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

	params := openai.ChatCompletionNewParams{
		Messages: openai.F(l.messages),
		Tools:    openai.F(persistTool.GetToolDefinition()),
		Model:    openai.F(openai.ChatModelGPT4o),
	}

	chatCompletion, err := l.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return "", err
	}

	for _, toolCall := range chatCompletion.Choices[0].Message.ToolCalls {
		if toolCall.Function.Name == "save_content" {
			persistTool.SaveContent(ctx, toolCall)
		}
		if toolCall.Function.Name == "search_content" {
			persistTool.SearchContent(ctx, toolCall)
		}
		params.Messages = openai.F(l.messages)
	}

	completion, err := l.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return "", err
	}

	return completion.Choices[0].Message.Content, nil
}

func getWeather(location string) string {
	return "The weather in " + location + " is sunny."
}
