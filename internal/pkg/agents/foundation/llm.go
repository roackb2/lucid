package foundation

import (
	"context"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
)

type FoundationModel interface {
	Chat(prompt string) (string, error)
}

type LLM struct {
	client *openai.Client
}

func NewFoundationModel() FoundationModel {
	client := openai.NewClient(
		option.WithAPIKey(config.Config.OpenAI.APIKey),
	)
	return &LLM{
		client: client,
	}
}

func (l *LLM) Chat(prompt string) (string, error) {
	chatCompletion, err := l.client.Chat.Completions.New(context.TODO(), openai.ChatCompletionNewParams{
		Messages: openai.F([]openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(SystemPrompt),
			openai.UserMessage(prompt),
		}),
		Model: openai.F(openai.ChatModelGPT4o),
	})
	if err != nil {
		return "", err
	}

	return chatCompletion.Choices[0].Message.Content, nil
}
