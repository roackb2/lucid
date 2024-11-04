package main

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents/agent"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/control_plane"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

func main() {
	defer utils.RecoverPanic()

	if err := config.LoadConfig("dev"); err != nil {
		slog.Error("Error loading configuration:", "error", err)
		panic(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	storage, err := storage.NewRelationalStorage()
	if err != nil {
		panic(err)
	}

	tracker := control_plane.NewMemoryAgentTracker()
	client := openai.NewClient(option.WithAPIKey(config.Config.OpenAI.APIKey))
	provider := providers.NewOpenAIChatProvider(client)
	pubSub := pubsub.NewKafkaPubSub()
	defer pubSub.Close()

	go func() {
		err := pubSub.Subscribe("agent_response", func(message string) error {
			slog.Info("Received PubSub response", "message", message)
			return nil
		})
		if err != nil {
			slog.Error("Error subscribing to agent_response", "error", err)
		}
	}()

	controllerConfig := control_plane.AgentControllerConfig{
		AgentLifeTime: 3 * time.Second,
	}
	controller := control_plane.NewAgentController(controllerConfig, storage, tracker)

	wg := sync.WaitGroup{}
	wg.Add(2)
	go func() {
		defer wg.Done()
		err := controller.Start(ctx)
		if err != nil {
			slog.Error("Error starting controller", "error", err)
		}
		slog.Info("Controller done")
	}()

	callbacks := worker.WorkerCallbacks{
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

	onAgentFound := func(agentID string, agentState dbaccess.AgentState) {
		slog.Info("Scheduler: Agent found", "agentID", agentState.AgentID)
		consumer := agent.NewConsumer("", storage, provider, pubSub)
		go func() {
			resp, err := consumer.ResumeTask(ctx, agentState.AgentID, nil, callbacks)
			if err != nil {
				slog.Error("Error resuming task", "error", err)
				panic(err)
			}
			slog.Info("Task response", "response", resp)
		}()
		agentID, err := controller.RegisterAgent(ctx, consumer)
		if err != nil {
			slog.Error("Error registering agent", "error", err)
			panic(err)
		}
		slog.Info("Registered agent", "agent_id", agentID)
	}

	scheduler := control_plane.NewScheduler(ctx, onAgentFound)
	go func() {
		defer wg.Done()
		err := scheduler.Start(ctx)
		if err != nil {
			slog.Error("Scheduler failed", "error", err)
			panic(err)
		}
	}()

	tasks := []string{
		"Is there any rock song with the word 'love' in the title?",
		"Find me a KPOP song with exciting beats.",
	}

	for _, task := range tasks {
		consumer := agent.NewConsumer(task, storage, provider, pubSub)
		go func() {
			resp, err := consumer.StartTask(ctx, callbacks)
			if err != nil {
				slog.Error("Error kicking off task", "error", err)
				panic(err)
			}
			slog.Info("Task response", "response", resp)
		}()
		agentID, err := controller.RegisterAgent(ctx, consumer)
		if err != nil {
			slog.Error("Error kicking off task", "error", err)
			panic(err)
		}
		slog.Info("Kicked off task", "agent_id", agentID)
	}

	time.Sleep(5 * time.Second)

	// Stop scheduler first to prevent registering new agents
	err = scheduler.SendCommand(ctx, "stop")
	if err != nil {
		slog.Error("Error stopping scheduler", "error", err)
	}

	time.Sleep(2 * time.Second)

	slog.Info("Stopping agents")
	err = controller.SendCommand(ctx, "stop")
	if err != nil {
		slog.Error("Error stopping agents", "error", err)
	}

	slog.Info("Waiting for agent controller to stop")

	wg.Wait()
	slog.Info("Agent controller stopped")
}
