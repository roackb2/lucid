package main

import (
	"log/slog"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

func main() {
	defer utils.RecoverPanic()

	if err := config.LoadConfig("dev"); err != nil {
		slog.Error("Error loading configuration:", "error", err)
		panic(err)
	}

	storage, err := storage.NewRelationalStorage()
	if err != nil {
		slog.Error("Error creating vector storage:", "error", err)
		panic(err)
	}
	defer storage.Close()

	controlCh := make(chan string, 1)
	reportCh := make(chan string, 1)

	client := openai.NewClient(option.WithAPIKey(config.Config.OpenAI.APIKey))
	provider := providers.NewOpenAIChatProvider(client)

	// Create a consumer with task that should not finish
	consumer := agents.NewConsumer("Is there any rock song? Keep searching until you find it.", storage, provider)

	doneCh := make(chan struct{}, 1)
	go (func() {
		resp, err := consumer.StartTask(controlCh, reportCh)
		if err != nil {
			slog.Error("Error starting task:", "error", err)
		}
		slog.Info("Task response:", "response", resp)
		doneCh <- struct{}{}
	})()

	<-doneCh
}
