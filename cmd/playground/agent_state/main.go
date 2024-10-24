package main

import (
	"encoding/json"
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

		restoredPublisher := agents.NewPublisher("", storage)
		err = restoredPublisher.RestoreState(publisher.GetID())
		if err != nil {
			slog.Error("Error restoring state:", "error", err)
			panic(err)
		}
		publisherState, err := json.Marshal(restoredPublisher)
		if err != nil {
			slog.Error("Error marshalling state:", "error", err)
			panic(err)
		}
		slog.Info("Publisher state restored", "state", string(publisherState))

	case err := <-errCh:
		slog.Error("Publisher error", "error", err)
	}
}
