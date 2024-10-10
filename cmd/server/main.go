package main

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/app/controllers"
)

// @title Lucid API
// @version 1.0
// @description This is the API for the Lucid project.
// @termsOfService http://swagger.io/terms/

// @contact.name API Support
// @contact.url http://www.swagger.io/support
// @contact.email support@swagger.io

func main() {
	r := gin.Default()
	r.GET("/healthz", controllers.Healthz)
	r.Run(fmt.Sprintf(":%s", config.Config.Server.Port)) // listen and serve on 0.0.0.0:8080 (for windows "localhost:8080")
}
