package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	docs "github.com/roackb2/lucid/api/swagger"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/app/controllers"
	"github.com/roackb2/lucid/internal/pkg/agents/agent"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/control_plane"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
	swaggerfiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

// @title Lucid API
// @version 1.0
// @description This is the API for the Lucid project.

// @contact.name Jay / Fienna Liang
// @contact.url https://github.com/roackb2
// @contact.email roackb2@gmail.com

// @host      localhost:8080

// @securityDefinitions.basic  None
func main() {
	r := gin.Default()
	docs.SwaggerInfo.BasePath = "/api/v1"

	if err := config.LoadConfig("dev"); err != nil {
		slog.Error("Error loading configuration:", "error", err)
		panic(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	storage, err := storage.NewRelationalStorage()
	if err != nil {
		slog.Error("Error creating storage", "error", err)
		panic(err)
	}

	tracker := control_plane.NewMemoryAgentTracker()
	client := openai.NewClient(option.WithAPIKey(config.Config.OpenAI.APIKey))
	provider := providers.NewOpenAIChatProvider(client)
	pubSub := pubsub.NewKafkaPubSub()

	controllerConfig := control_plane.AgentControllerConfig{
		AgentLifeTime: 3 * time.Second,
	}
	controller := control_plane.NewAgentController(controllerConfig, storage, tracker)
	scheduler := control_plane.NewScheduler(ctx, nil)
	agentFactory := &agent.RealAgentFactory{}
	controlPlaneCallbacks := control_plane.ControlPlaneCallbacks{
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
	controlPlane := control_plane.NewControlPlane(agentFactory, storage, provider, controller, scheduler, pubSub, controlPlaneCallbacks, workerCallbacks)

	go func() {
		err := controlPlane.Start(ctx)
		if err != nil {
			slog.Error("Error starting control plane", "error", err)
			panic(err)
		}
		slog.Info("Control plane started")
	}()

	agentRouterController := controllers.NewAgentRouterController(ctx, controlPlane)
	v1 := r.Group("/api/v1")
	{
		users := v1.Group("/users")
		{
			users.POST("/", controllers.CreateMockUser)
		}

		agents := v1.Group("/agents/")
		{
			agents.POST("/create", agentRouterController.StartAgent)
		}
	}
	r.GET("/healthz", controllers.Healthz)
	r.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerfiles.Handler))

	// Home page
	r.StaticFile("/", "./client/dist/index.html")
	r.StaticFile("/favicon.ico", "./client/dist/favicon.ico")
	r.Static("/assets", "./client/dist/assets")

	log.Println("Server is running on port", config.Config.Server.Port)
	r.Run(fmt.Sprintf(":%s", config.Config.Server.Port))
}
