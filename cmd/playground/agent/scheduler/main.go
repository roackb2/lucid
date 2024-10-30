package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/control_plane"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

func main() {
	defer utils.RecoverPanic()

	if err := config.LoadConfig("dev"); err != nil {
		slog.Error("Error loading configuration:", "error", err)
		panic(err)
	}

	err := dbaccess.Initialize()
	if err != nil {
		slog.Error("RelationalStorage: Failed to initialize querier", "error", err)
		panic(err)
	}

	ctx := context.Background()

	controlCh := make(chan string)
	reportCh := make(chan string)
	errCh := make(chan error)

	scheduler := control_plane.NewScheduler(ctx)
	scheduler.Start(ctx, controlCh, reportCh, errCh)

	time.Sleep(5 * time.Second)
	controlCh <- "stop"

	select {
	case msg := <-reportCh:
		slog.Info("Scheduler stopped", "message", msg)
	case err := <-errCh:
		slog.Error("Scheduler failed", "error", err)
	}

	// storage, err := storage.NewRelationalStorage()
	// if err != nil {
	// 	panic(err)
	// }

	// 	tracker := control_plane.NewMemoryAgentTracker()
	// 	bus := control_plane.NewChannelBus(65536)
	// 	go func() {
	// 		for {
	// 			// Bus should guarantee thread safety, so we can read from another goroutine
	// 			resp := bus.ReadResponse()
	// 			slog.Info("Received response", "response", resp)
	// 		}
	// 	}()

	// 	controllerConfig := control_plane.AgentControllerConfig{
	// 		AgentLifeTime: 3 * time.Second,
	// 	}
	// 	controller := control_plane.NewAgentController(controllerConfig, storage, bus, tracker)
	// 	controlCh := make(chan string)
	// 	reportCh := make(chan string)
	// 	client := openai.NewClient(option.WithAPIKey(config.Config.OpenAI.APIKey))
	// 	provider := providers.NewOpenAIChatProvider(client)
	// 	controller.Start(controlCh, reportCh)

	// 	tasks := []string{
	// 		"Is there any rock song with the word 'love' in the title?",
	// 		"Find me a KPOP song with exciting beats.",
	// 	}

	// 	agentIDs := []string{}
	// 	for _, task := range tasks {
	// 		agentID, err := controller.KickoffTask(ctx, fmt.Sprintf("%s Keep looking for the item until you find it", task), "consumer", provider)
	// 		if err != nil {
	// 			slog.Error("Error kicking off task", "error", err)
	// 			panic(err)
	// 		}
	// 		slog.Info("Kicked off task", "agent_id", agentID)
	// 		agentIDs = append(agentIDs, agentID)
	// 	}

	// time.Sleep(5 * time.Second)
	// controlCh <- "stop"
	//
	//	for _, agentID := range agentIDs {
	//		status, err := controller.GetAgentStatus(agentID)
	//		if err != nil {
	//			slog.Error("Error getting agent status", "error", err)
	//			panic(err)
	//		}
	//		if status != foundation.StatusTerminated {
	//			slog.Error("Agent status is not terminated", "agent_id", agentID, "status", status)
	//			panic("Agent status is not terminated")
	//		}
	//	}
	//
	// msg := <-reportCh
	// slog.Info("Agent controller stopped", "message", msg)
}
