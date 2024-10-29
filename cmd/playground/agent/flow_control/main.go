package main

import (
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
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

	// Create a consumer with task that should not finish
	consumer := agents.NewConsumer("Is there any rock song? Keep searching until you find it.", storage, provider)

	go func() {
		response, err := consumer.StartTask(controlCh, reportCh)
		if err != nil {
			slog.Error("Consumer error", "error", err)
			panic(err)
		}
		fmt.Println("Response:", response)
		os.Exit(0)
	}()

	time.Sleep(300 * time.Millisecond)

	controlCh <- foundation.CmdPause
	slog.Info("Sent pause command")
	status := <-reportCh
	slog.Info("Received:", "status", status)

	time.Sleep(300 * time.Millisecond)

	controlCh <- foundation.CmdResume
	slog.Info("Sent resume command")
	status = <-reportCh
	slog.Info("Received:", "status", status)

	time.Sleep(300 * time.Millisecond)

	controlCh <- foundation.CmdTerminate
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
