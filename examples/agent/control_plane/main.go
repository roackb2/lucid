package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents/agent"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/control_plane"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

func main() {
	defer utils.RecoverPanic()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := config.LoadConfig("dev"); err != nil {
		slog.Error("Error loading configuration:", "error", err)
		panic(err)
	}

	storage, err := storage.NewRelationalStorage()
	if err != nil {
		slog.Error("Error creating storage", "error", err)
		panic(err)
	}

	tracker := control_plane.NewMemoryAgentTracker()
	client := openai.NewClient(option.WithAPIKey(config.Config.OpenAI.APIKey))
	provider := providers.NewOpenAIChatProvider(client)
	controllerConfig := control_plane.AgentControllerConfig{
		AgentLifeTime: 3 * time.Second,
	}
	controller := control_plane.NewAgentController(controllerConfig, storage, tracker)
	scheduler := control_plane.NewScheduler(ctx, nil)
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

	agentFactory := &agent.RealAgentFactory{}
	callbacks := control_plane.ControlPlaneCallbacks{
		control_plane.ControlPlaneEventAgentFinalResponse: func(agentID string, response string) {
			slog.Info("Agent final response", "agent_id", agentID, "response", response)
		},
	}
	workerCallbacks := worker.WorkerCallbacks{
		worker.OnPause: func(agentID string, status string) {
			slog.Info("Pausing agent", "agent_id", agentID, "status", status)
		},
		worker.OnResume: func(agentID string, status string) {
			slog.Info("Resuming agent", "agent_id", agentID, "status", status)
		},
		worker.OnSleep: func(agentID string, status string) {
			slog.Info("Agent sleeping", "agent_id", agentID, "status", status)
		},
		worker.OnTerminate: func(agentID string, status string) {
			slog.Info("Agent terminating", "agent_id", agentID, "status", status)
		},
	}
	controlPlane := control_plane.NewControlPlane(agentFactory, storage, provider, controller, scheduler, pubSub, callbacks, workerCallbacks)

	doneCh := make(chan struct{})

	go func() {
		err := controlPlane.Start(ctx)
		if err != nil {
			slog.Error("Error starting control plane", "error", err)
			panic(err)
		}
		doneCh <- struct{}{}
	}()

	tasks := []string{
		"Is there any rock song with the word 'love' in the title?",
		"Find me a KPOP song with exciting beats.",
	}

	for _, task := range tasks {
		err := controlPlane.KickoffTask(ctx, task, "consumer")
		if err != nil {
			slog.Error("Error kicking off task", "error", err)
			panic(err)
		}
	}

	time.Sleep(5 * time.Second)

	slog.Info("Stopping control plane")
	controlPlane.SendCommand(ctx, "stop")

	slog.Info("Waiting for control plane to stop")
	<-doneCh
	slog.Info("Control plane stopped")
}
