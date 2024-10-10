package main

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	docs "github.com/roackb2/lucid/api/swagger"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/app/controllers"
	"github.com/roackb2/lucid/internal/app/controllers/example"
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

	v1 := r.Group("/api/v1")
	{
		eg := v1.Group("/example")
		{
			eg.GET("/helloworld", example.HelloWorld)
		}
		users := v1.Group("/users")
		{
			users.POST("/", controllers.CreateMockUser)
		}
	}
	r.GET("/healthz", controllers.Healthz)
	r.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerfiles.Handler))
	log.Println("Server is running on port", config.Config.Server.Port)
	r.Run(fmt.Sprintf(":%s", config.Config.Server.Port))
}
