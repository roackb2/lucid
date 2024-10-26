package main

import (
	"fmt"
	"log/slog"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

func main() {
	defer utils.RecoverPanic()

	storage, err := storage.NewRelationalStorage()
	if err != nil {
		slog.Error("Error creating vector storage:", "error", err)
		panic(err)
	}
	defer storage.Close()

	controlCh := make(chan string, 1)
	reportCh := make(chan string, 1)

	publisher := agents.NewPublisher(fmt.Sprintf("I have a new song called '%s'. Please publish it.", "Jazz in the Rain"), storage)

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
	restoredPublisher := agents.NewPublisher("", storage)
	newPrompt := "What is the length of the title of the song that you just published?"
	res, err = restoredPublisher.ResumeTask(publisher.GetID(), &newPrompt, controlCh, reportCh)
	if err != nil {
		slog.Error("Publisher error", "error", err)
		panic(err)
	}
	slog.Info("Publisher response", "response", res)
}
