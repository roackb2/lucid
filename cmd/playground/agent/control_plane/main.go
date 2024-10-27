package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/control_plane"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

func main() {
	defer utils.RecoverPanic()

	if err := config.LoadConfig("dev"); err != nil {
		slog.Error("Error loading configuration:", "error", err)
		panic(err)
	}

	ctx := context.Background()
	storage, err := storage.NewRelationalStorage()
	if err != nil {
		panic(err)
	}

	tracker := control_plane.NewMemoryAgentTracker()
	bus := control_plane.NewChannelBus(65536)
	go func() {
		for {
			// Bus should guarantee thread safety, so we can read from another goroutine
			resp := bus.ReadResponse()
			slog.Info("Received response", "response", resp)
		}
	}()

	config := control_plane.AgentControllerConfig{
		AgentLifeTime: 3 * time.Second,
	}
	controller := control_plane.NewAgentController(config, storage, bus, tracker)
	controlCh := make(chan string)
	reportCh := make(chan string)
	controller.Start(controlCh, reportCh)

	tasks := []string{
		"Is there any rock song with the word 'love' in the title?",
		"Find me a KPOP song with exciting beats.",
	}

	for _, task := range tasks {
		controller.KickoffTask(ctx, fmt.Sprintf("%s Keep looking for the item until you find it", task), "consumer")
	}

	time.Sleep(5 * time.Second)
	controlCh <- "stop"
	msg := <-reportCh
	slog.Info("Agent controller stopped", "message", msg)
}
