package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/controlplane"
)

func main() {
	ctx := context.Background()
	storage, err := storage.NewRelationalStorage()
	if err != nil {
		panic(err)
	}

	bus := controlplane.NewChannelBus(65536)
	go func() {
		for {
			// Bus should guarantee thread safety, so we can read from another goroutine
			resp := bus.ReadResponse()
			slog.Info("Received response", "response", resp)
		}
	}()

	config := controlplane.AgentControllerConfig{
		AgentLifeTime: 3 * time.Second,
	}
	controller := controlplane.NewAgentController(config, storage, bus)
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
