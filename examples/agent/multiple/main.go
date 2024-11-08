package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

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

var outputDir = "data/output"

func main() {
	utils.RecoverPanic()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := config.LoadConfig("dev"); err != nil {
		slog.Error("Error loading configuration:", "error", err)
		panic(err)
	}

	storage, err := storage.NewRelationalStorage()
	// storage, err := storage.NewVectorStorage()
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

	songs := []string{
		"Jazz in the Rain",
		"Awesome Jazz Music Playlist",
		// "Jazz Music for Relaxation",
		// "Jazz Music for Focus",
		// "Jazz Music for Studying",
		// "Jazz Music for Working",
	}
	publishers := []agent.Publisher{}
	for _, song := range songs {
		publishers = append(publishers, *agent.NewPublisher(fmt.Sprintf("I have a new song called '%s'. Please publish it.", song), storage, provider, pubSub))
	}

	queries := []string{
		"Is there any new Jazz music?",
		// "I'm looking for some Jazz music to study to.",
		// "I need some Jazz music to relax to.",
	}
	consumers := []agent.Consumer{}
	for _, query := range queries {
		consumers = append(consumers, *agent.NewConsumer(query, storage, provider, pubSub))
	}

	var wg sync.WaitGroup
	resCh := make(chan *agent.AgentResponse, len(publishers)+len(consumers))
	errCh := make(chan error, 1)

	numWorkers := len(publishers) + len(consumers)

	// Increment WaitGroup counter for each task
	wg.Add(numWorkers)

	callbacks := worker.WorkerCallbacks{
		worker.OnPause: func(agentID string, status string) {
			slog.Info("onPause", "agentID", agentID, "status", status)
		},
		worker.OnResume: func(agentID string, status string) {
			slog.Info("onResume", "agentID", agentID, "status", status)
		},
		worker.OnTerminate: func(agentID string, status string) {
			slog.Info("onTerminate", "agentID", agentID, "status", status)
		},
	}

	for _, publisher := range publishers {
		// Launch publisher task
		go func() {
			defer wg.Done() // Decrement counter when task is done
			defer publisher.Close()
			res, err := publisher.StartTask(ctx, callbacks)
			if err != nil {
				errCh <- err
				return
			}
			publisher.PersistState()
			resCh <- res
		}()
	}

	for _, consumer := range consumers {
		// Launch consumer task
		go func() {
			defer wg.Done() // Decrement counter when task is done
			defer consumer.Close()
			res, err := consumer.StartTask(ctx, callbacks)
			if err != nil {
				errCh <- err
				return
			}
			consumer.PersistState()
			resCh <- res
		}()
	}

	// Close the response channel when all tasks are done
	go func() {
		wg.Wait() // Wait for all goroutines to finish
		close(resCh)
	}()

	// Remove all files in the output directory
	if err := removeAllFiles(outputDir); err != nil {
		slog.Error("Error removing all files:", "error", err)
		panic(err)
	}

	// Read from channels
	for {
		select {
		case response, ok := <-resCh:
			if !ok {
				// resCh is closed and all messages are received
				return
			}
			slog.Info("Received response", "response", response)
			writeToFile(fmt.Sprintf("%s_%s.txt", response.Role, response.Id), response.Message)
		case err := <-errCh:
			slog.Error("Error", "error", err)
			return // Exit on error
		}
	}
}

func writeToFile(filename string, content string) error {
	if _, err := os.Stat(outputDir); os.IsNotExist(err) {
		os.Mkdir(outputDir, 0755)
	}

	if _, err := os.Stat(filepath.Join(outputDir, filename)); os.IsNotExist(err) {
		file, err := os.Create(filepath.Join(outputDir, filename))
		if err != nil {
			return err
		}
		defer file.Close()

		_, err = file.WriteString(content)
		return err
	}
	return nil
}

func removeAllFiles(dir string) error {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return nil
	}
	files, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("failed to read directory: %w", err)
	}
	for _, f := range files {
		if err := os.Remove(filepath.Join(dir, f.Name())); err != nil {
			return fmt.Errorf("failed to remove file %s: %w", f.Name(), err)
		}
	}
	return nil
}
