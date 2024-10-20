package foundation

import (
	"context"
	"encoding/json"

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
	ctx := context.Background()

	params := openai.ChatCompletionNewParams{
		Messages: openai.F([]openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(SystemPrompt),
			openai.UserMessage(prompt),
		}),
		Tools: openai.F([]openai.ChatCompletionToolParam{
			{
				Type: openai.F(openai.ChatCompletionToolTypeFunction),
				Function: openai.F(openai.FunctionDefinitionParam{
					Name:        openai.String("get_weather"),
					Description: openai.String("Get weather at the given location"),
					Parameters: openai.F(openai.FunctionParameters{
						"type": "object",
						"properties": map[string]interface{}{
							"location": map[string]string{
								"type": "string",
							},
						},
						"required": []string{"location"},
					}),
				}),
			},
		}),
		Model: openai.F(openai.ChatModelGPT4o),
	}

	chatCompletion, err := l.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return "", err
	}

	for _, toolCall := range chatCompletion.Choices[0].Message.ToolCalls {
		if toolCall.Function.Name == "get_weather" {
			// extract the location from the function call arguments
			var args map[string]interface{}
			_ = json.Unmarshal([]byte(toolCall.Function.Arguments), &args)

			// call a weather API with the arguments requested by the model
			weatherData := getWeather(args["location"].(string))
			params.Messages.Value = append(params.Messages.Value, openai.ToolMessage(toolCall.ID, weatherData))
		}
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
