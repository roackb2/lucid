package main

import (
	"fmt"
	"log/slog"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

func main() {
	defer func() {
		r := recover()
		if r != nil {
			fmt.Println("Recovered from panic:", r)
		}
	}()

	storage, err := storage.NewRelationalStorage()
	if err != nil {
		slog.Error("Error creating vector storage:", "error", err)
		panic(err)
	}
	publisher := agents.NewPublisher(fmt.Sprintf("I have a new song called '%s'. Please publish it.", "Jazz in the Rain"), storage)

	resCh := make(chan agents.AgentResponse, 1)
	errCh := make(chan error, 1)

	publisher.StartTask(resCh, errCh)

	select {
	case res := <-resCh:
		slog.Info("Publisher response", "response", res)
	case err := <-errCh:
		slog.Error("Publisher error", "error", err)
	}

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
	restoredPublisher.ResumeTask(publisher.GetID(), &newPrompt, resCh, errCh)
	select {
	case res := <-resCh:
		slog.Info("Publisher response", "response", res)
	case err := <-errCh:
		slog.Error("Publisher error", "error", err)
	}
}
