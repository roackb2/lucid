package foundation_models

import (
	"context"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
)

var (
	openai_client *openai.Client
)

func init() {
	openai_client = openai.NewClient(
		option.WithAPIKey(config.Config.OpenAI.APIKey),
	)
}

func Chat(prompt string) (string, error) {
	chatCompletion, err := openai_client.Chat.Completions.New(context.TODO(), openai.ChatCompletionNewParams{
		Messages: openai.F([]openai.ChatCompletionMessageParamUnion{
			openai.UserMessage("Say this is a test"),
		}),
		Model: openai.F(openai.ChatModelGPT4o),
	})
	if err != nil {
		return "", err
	}

	return chatCompletion.Choices[0].Message.Content, nil
}
