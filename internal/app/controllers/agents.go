package controllers

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
)

type StartAgentRequest struct {
	Role string `json:"role" binding:"required"`
	Task string `json:"task" binding:"required"`
}

type AgentRouterController struct {
}

func NewAgentRouterController() *AgentRouterController {
	return &AgentRouterController{}
}

// StartAgent godoc
// @Summary Start a new agent
// @Description Starts a new agent with role and task
// @Tags agents
// @Accept json
// @Produce json
// @Param agent body StartAgentRequest true "Agent details"
// @Success 201 {object} map[string]string "Agent created successfully"
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /api/v1/agents/create [post]
func (ac *AgentRouterController) StartAgent(c *gin.Context) {
	var agent StartAgentRequest
	if err := c.ShouldBindJSON(&agent); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	slog.Info("Starting agent", "role", agent.Role, "task", agent.Task)

	c.JSON(http.StatusCreated, gin.H{"message": "Agent created successfully"})
}
