package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Healthz godoc
//	@Summary		Health check endpoint
//	@Description	Returns the health status of the application
//	@Tags			healthz
//	@Produce		json
//	@Success		200	{object}	map[string]string
//	@Router			/healthz [get]
func Healthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
	})
}
