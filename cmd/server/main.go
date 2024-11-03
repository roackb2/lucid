package main

import (
	"fmt"
	"log"
	"log/slog"

	"github.com/gin-gonic/gin"
	docs "github.com/roackb2/lucid/api/swagger"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/app/controllers"
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

	agentRouterController := controllers.NewAgentRouterController()

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
