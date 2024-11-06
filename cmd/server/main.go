package main

import (
	"context"
	"flag"
	"fmt"
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
	// Command line flags
	var withControlPlane bool

	flag.BoolVar(&withControlPlane, "with-control-plane", true, "Whether to start the control plane")
	help := flag.Bool("help", false, "Help")
	flag.Parse()

	if *help {
		flag.Usage()
		return
	}

	// Load configuration
	if err := config.LoadConfig("dev"); err != nil {
		slog.Error("Error loading configuration:", "error", err)
		panic(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initialize control plane components
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

	if withControlPlane {
		go func() {
			err := controlPlane.Start(ctx)
			if err != nil {
				slog.Error("Error starting control plane", "error", err)
				panic(err)
			}
			slog.Info("Control plane started")
		}()
	}

	// Initialize HTTP server
	server := gin.Default()
	docs.SwaggerInfo.BasePath = "/api/v1"
	agentRouterController := controllers.NewAgentRouterController(ctx, controlPlane)
	v1 := server.Group("/api/v1")
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
	server.GET("/healthz", controllers.Healthz)
	server.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerfiles.Handler))

	// Home page
	server.StaticFile("/", "./client/dist/index.html")
	server.StaticFile("/favicon.ico", "./client/dist/favicon.ico")
	server.Static("/assets", "./client/dist/assets")

	stopChan := make(chan struct{})

	go func() {
		port := config.Config.Server.Port
		slog.Info("Server is running on port", "port", port)
		err := server.Run(fmt.Sprintf(":%s", port))
		if err != nil {
			slog.Error("Error running server", "error", err)
			panic(err)
		}
	}()

	// Initialize websocket server
	wsServer := gin.Default()

	websocketController := controllers.NewWebsocketController(ctx, pubSub)
	wsGroup := wsServer.Group("/")
	{
		wsGroup.GET("/", websocketController.SocketHandler)
	}

	go func() {
		port := config.Config.Websocket.Port
		slog.Info("Websocket server is running on port", "port", port)
		err := wsServer.Run(fmt.Sprintf(":%s", port))
		if err != nil {
			slog.Error("Error running websocket server", "error", err)
			panic(err)
		}
	}()

	// Wait for stop signal
	select {
	case <-stopChan:
		slog.Info("Stopping server")
		return
	case <-ctx.Done():
		slog.Info("Stopping server")
		return
	}
}
