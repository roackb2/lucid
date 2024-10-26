package main

import (
	"fmt"
	"log/slog"
	"os"
	"time"

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
	defer storage.Close()

	controlCh := make(chan string, 1)
	reportCh := make(chan string, 1)

	publisher := agents.NewPublisher(fmt.Sprintf("I have a new song called '%s'. Please publish it.", "Jazz in the Rain"), storage)

	go func() {
		response, err := publisher.StartTask(controlCh, reportCh)
		if err != nil {
			slog.Error("Publisher error", "error", err)
			panic(err)
		}
		fmt.Println("Response:", response)
		os.Exit(0)
	}()

	time.Sleep(1 * time.Second)

	controlCh <- "pause"
	slog.Info("Sent pause command")
	status := <-reportCh
	slog.Info("Received:", "status", status)

	time.Sleep(1 * time.Second)

	controlCh <- "resume"
	slog.Info("Sent resume command")
	status = <-reportCh
	slog.Info("Received:", "status", status)

	time.Sleep(1 * time.Second)

	controlCh <- "terminate"
	slog.Info("Sent terminate command")
	status = <-reportCh
	slog.Info("Received:", "status", status)

	slog.Info("Done")

	// // Store the state
	// err = publisher.PersistState()
	// if err != nil {
	// 	slog.Error("Error persisting state:", "error", err)
	// 	panic(err)
	// }
	// slog.Info("Publisher state persisted")

	// // Restore the state
	// restoredPublisher := agents.NewPublisher("", storage)
	// newPrompt := "What is the length of the title of the song that you just published?"
	// res, err := restoredPublisher.ResumeTask(publisher.GetID(), &newPrompt, controlCh, reportCh)
	// if err != nil {
	// 	slog.Error("Publisher error", "error", err)
	// 	panic(err)
	// }
	// slog.Info("Publisher response", "response", res)
}