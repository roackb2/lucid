package main

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents/agent"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
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
		err := pubSub.Subscribe("agent_response", func(message string) error {
			slog.Info("Received PubSub response", "message", message)
			return nil
		})
		if err != nil {
			slog.Error("Error subscribing to agent_response", "error", err)
		}
	}()
	publisher := agent.NewPublisher(fmt.Sprintf("I have a new song called '%s'. Please publish it.", "Jazz in the Rain"), storage, provider, pubSub)

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
		worker.OnTerminate: func(agentID string, status string) {
			slog.Info("Command callback", "agentID", agentID, "status", status)
		},
	}
	res, err := publisher.StartTask(ctx, callbacks)
	defer publisher.Close()

	if err != nil {
		slog.Error("Publisher error", "error", err)
		panic(err)
	}
	slog.Info("Publisher response", "response", res)

	// Store the state
	err = publisher.PersistState()
	if err != nil {
		slog.Error("Error persisting state:", "error", err)
		panic(err)
	}
	slog.Info("Publisher state persisted")

	// Make sure the state is stored in the database
	agentState, err := dbaccess.Querier.GetAgentState(context.Background(), publisher.GetID())
	if err != nil {
		slog.Error("Error getting agent state:", "error", err)
		panic(err)
	}
	// Make sure the state contains the song title
	if !strings.Contains(string(agentState.State), "Jazz in the Rain") {
		slog.Error("Agent state does not contain the song title", "state", string(agentState.State))
		panic("Agent state does not contain the song title")
	}

	// Restore the state
	restoredPublisher := agent.NewPublisher("", storage, provider, pubSub)
	newPrompt := "What is the length of the title of the song that you just published?"
	res, err = restoredPublisher.ResumeTask(ctx, publisher.GetID(), &newPrompt, callbacks)
	if err != nil {
		slog.Error("Publisher error", "error", err)
		panic(err)
	}
	slog.Info("Publisher response", "response", res)
}
