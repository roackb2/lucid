package main

import (
	"fmt"
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

	publisher := agents.NewPublisher(fmt.Sprintf("I have a new song called '%s'. Please publish it.", "Jazz in the Rain"), storage, provider)

	res, err := publisher.StartTask(controlCh, reportCh)
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

	// Restore the state
	restoredPublisher := agents.NewPublisher("", storage, provider)
	newPrompt := "What is the length of the title of the song that you just published?"
	res, err = restoredPublisher.ResumeTask(publisher.GetID(), &newPrompt, controlCh, reportCh)
	if err != nil {
		slog.Error("Publisher error", "error", err)
		panic(err)
	}
	slog.Info("Publisher response", "response", res)
}
