package main

import (
	"context"
	"log/slog"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

func main() {
	defer utils.RecoverPanic()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

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

	client := openai.NewClient(option.WithAPIKey(config.Config.OpenAI.APIKey))
	provider := providers.NewOpenAIChatProvider(client)

	// Create a consumer with task that should not finish
	consumer := agents.NewPublisher("I have a song called 'Rock and Roll', please publish it.", storage, provider)

	doneCh := make(chan struct{}, 1)
	callbacks := worker.WorkerCallbacks{
		worker.OnPause: func(agentID string, status string) {
			slog.Info("Command callback", "agentID", agentID, "status", status)
		},
		worker.OnResume: func(agentID string, status string) {
			slog.Info("Command callback", "agentID", agentID, "status", status)
		},
		worker.OnSleep: func(agentID string, status string) {
			slog.Info("Command callback", "agentID", agentID, "status", status)
		},
	}
	go func() {
		resp, err := consumer.StartTask(ctx, callbacks)
		if err != nil {
			slog.Error("Error starting task:", "error", err)
		}
		slog.Info("Task response:", "response", resp)
		doneCh <- struct{}{}
	}()

	<-doneCh
}
