package main

import (
	"context"
	"log/slog"
	"os"
	"time"

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
	consumer := agents.NewConsumer("Is there any rock song? Keep searching until you find it.", storage, provider)

	callbacks := worker.WorkerCallbacks{
		worker.OnPause: func(agentID string, status string) {
			slog.Info("Status:", "agentID", agentID, "status", status)
			if status != worker.StatusPaused {
				slog.Error("Consumer state is not paused", "state", status)
				panic("Consumer state is not paused")
			}
		},
		worker.OnResume: func(agentID string, status string) {
			slog.Info("Status:", "agentID", agentID, "status", status)
			if status != worker.StatusRunning {
				slog.Error("Consumer state is not running", "state", status)
				panic("Consumer state is not running")
			}
		},
		worker.OnSleep: func(agentID string, status string) {
			slog.Info("Status:", "agentID", agentID, "status", status)
			if status != worker.StatusAsleep {
				slog.Error("Consumer state is not asleep", "state", status)
				panic("Consumer state is not asleep")
			}
		},
	}

	go func() {
		response, err := consumer.StartTask(ctx, callbacks)
		if err != nil {
			slog.Error("Consumer error", "error", err)
			panic(err)
		}
		slog.Info("Response:", "response", response)
		os.Exit(0)
	}()

	time.Sleep(300 * time.Millisecond)

	consumer.SendCommand(worker.CmdPause)

	time.Sleep(300 * time.Millisecond)

	consumer.SendCommand(worker.CmdResume)

	time.Sleep(300 * time.Millisecond)

	consumer.SendCommand(worker.CmdSleep)

	slog.Info("Done")
}
