package example

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// HelloWorld godoc
// @Summary Hello World
// @Description Hello World
// @Tags helloworld
// @Accept json
// @Produce json
// @Success 200 {object} map[string]string
// @Router /api/v1/example/helloworld [get]
func HelloWorld(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"message": "Hello World",
	})
}
