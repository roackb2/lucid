package controllers

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/roackb2/lucid/internal/pkg/control_plane"
)

type StartAgentRequest struct {
	Role string `json:"role" binding:"required"`
	Task string `json:"task" binding:"required"`
}

type AgentRouterController struct {
	ctx          context.Context
	controlPlane control_plane.ControlPlane
}

func NewAgentRouterController(ctx context.Context, controlPlane control_plane.ControlPlane) *AgentRouterController {
	return &AgentRouterController{
		ctx:          ctx,
		controlPlane: controlPlane,
	}
}

// StartAgent godoc
//	@Summary		Start a new agent
//	@Description	Starts a new agent with role and task
//	@Tags			agents
//	@Accept			json
//	@Produce		json
//	@Param			agent	body		StartAgentRequest	true	"Agent details"
//	@Success		201		{object}	map[string]string	"Agent created successfully"
//	@Failure		400		{object}	map[string]string	"Bad request"
//	@Failure		500		{object}	map[string]string	"Internal server error"
//	@Router			/api/v1/agents/create [post]
func (ac *AgentRouterController) StartAgent(c *gin.Context) {
	var agent StartAgentRequest
	if err := c.ShouldBindJSON(&agent); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := ac.controlPlane.KickoffTask(ac.ctx, agent.Task, agent.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	slog.Info("Starting agent", "role", agent.Role, "task", agent.Task)

	c.JSON(http.StatusCreated, gin.H{"message": "Agent created successfully"})
}
