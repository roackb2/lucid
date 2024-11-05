package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents/agent"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
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
	pubSub := pubsub.NewKafkaPubSub()
	defer pubSub.Close()

	go func() {
		err := pubSub.Subscribe(worker.GetAgentResponseGeneralTopic(), func(message string) error {
			slog.Info("Received PubSub response", "message", message)
			return nil
		})
		if err != nil {
			slog.Error("Error subscribing to agent_response", "error", err)
		}
	}()

	// Create a consumer with task that should not finish
	consumer := agent.NewConsumer("Is there any rock song? Keep searching until you find it.", storage, provider, pubSub)

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
			slog.Info("Agent sleeping", "agent_id", agentID, "status", status)
			if status != worker.StatusAsleep {
				slog.Error("Consumer state is not asleep", "state", status)
				panic("Consumer state is not asleep")
			}
		},
		worker.OnTerminate: func(agentID string, status string) {
			slog.Info("Status:", "agentID", agentID, "status", status)
			if status != worker.StatusTerminated {
				slog.Error("Consumer state is not terminated", "state", status)
				panic("Consumer state is not terminated")
			}
		},
	}

	go func() {
		defer consumer.Close()
		response, err := consumer.StartTask(ctx, callbacks)
		if err != nil {
			slog.Error("Consumer error", "error", err)
			panic(err)
		}
		slog.Info("Response:", "response", response)
		os.Exit(0)
	}()

	time.Sleep(300 * time.Millisecond)

	err = consumer.SendCommand(context.Background(), worker.CmdPause)
	if err != nil {
		slog.Error("Consumer error sending command", "error", err)
		panic(err)
	}

	time.Sleep(300 * time.Millisecond)

	err = consumer.SendCommand(context.Background(), worker.CmdResume)
	if err != nil {
		slog.Error("Consumer error sending command", "error", err)
		panic(err)
	}

	time.Sleep(300 * time.Millisecond)

	err = consumer.SendCommand(context.Background(), worker.CmdTerminate)
	if err != nil {
		slog.Error("Consumer error sending command", "error", err)
		panic(err)
	}

	slog.Info("Done")
}
