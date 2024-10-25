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

	go publisher.StartTask(resCh, errCh)

	select {
	case res := <-resCh:
		slog.Info("Publisher response", "response", res)
		err = publisher.PersistState()
		if err != nil {
			slog.Error("Error persisting state:", "error", err)
			panic(err)
		}
		slog.Info("Publisher state persisted")
		go storeAndResume(publisher.GetID(), storage)
	case err := <-errCh:
		slog.Error("Publisher error", "error", err)
	}
}

func storeAndResume(agentID string, storage storage.Storage) {
	restoredPublisher := agents.NewPublisher("", storage)
	resCh := make(chan agents.AgentResponse, 1)
	errCh := make(chan error, 1)

	go restoredPublisher.ResumeTask(agentID, resCh, errCh)
	select {
	case res := <-resCh:
		slog.Info("Publisher response", "response", res)
	case err := <-errCh:
		slog.Error("Publisher error", "error", err)
	}
}
