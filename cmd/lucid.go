package main

import (
	"context"
	"fmt"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/spf13/viper"
)

var (
	vp            *viper.Viper
	openai_client *openai.Client
)

func init() {
	vp := viper.New()
	vp.SetEnvPrefix("lucid")
	vp.AutomaticEnv()
	vp.SetConfigName("dev")
	vp.AddConfigPath("configs/")
	vp.SetConfigType("yaml")
	err := vp.ReadInConfig()
	if err != nil {
		panic(fmt.Errorf("fatal error config file: %s", err))
	}
	openai_api_key := vp.GetString("openai.api_key")
	if openai_api_key == "" {
		panic("openai.api_key is not set")
	}
	openai_client = openai.NewClient(
		option.WithAPIKey(openai_api_key),
	)
}

func main() {
	chatCompletion, err := openai_client.Chat.Completions.New(context.TODO(), openai.ChatCompletionNewParams{
		Messages: openai.F([]openai.ChatCompletionMessageParamUnion{
			openai.UserMessage("Say this is a test"),
		}),
		Model: openai.F(openai.ChatModelGPT4o),
	})
	if err != nil {
		panic(err.Error())
	}
	fmt.Println(chatCompletion.Choices[0].Message.Content)
}
