package control_plane

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

var (
	// Exported for testing
	NewAgentFunc = newAgent
)

type AgentControllerConfig struct {
	ScanInterval  time.Duration
	AgentLifeTime time.Duration
	MaxRespChSize int
}

type AgentController struct {
	cfg AgentControllerConfig

	storage storage.Storage
	tracker AgentTracker
	bus     NotificationBus

	onPause     foundation.CommandCallback
	onResume    foundation.CommandCallback
	onTerminate foundation.CommandCallback
}

func NewAgentController(cfg AgentControllerConfig, storage storage.Storage, bus NotificationBus, tracker AgentTracker) *AgentController {
	scanInterval := utils.GetOrDefault(cfg.ScanInterval, 1*time.Second)
	agentLifeTime := utils.GetOrDefault(cfg.AgentLifeTime, 5*time.Minute)
	maxRespChSize := utils.GetOrDefault(cfg.MaxRespChSize, 65536)
	mergedCfg := AgentControllerConfig{
		ScanInterval:  scanInterval,
		AgentLifeTime: agentLifeTime,
		MaxRespChSize: maxRespChSize,
	}
	// TODO: Report status to the caller
	onPause := func(status string) { slog.Info("AgentController onPause", "status", status) }
	onResume := func(status string) { slog.Info("AgentController onResume", "status", status) }
	onTerminate := func(status string) { slog.Info("AgentController onTerminate", "status", status) }
	controller := &AgentController{
		cfg:         mergedCfg,
		storage:     storage,
		bus:         bus,
		tracker:     tracker,
		onPause:     onPause,
		onResume:    onResume,
		onTerminate: onTerminate,
	}
	return controller
}

func (c *AgentController) Start(ctx context.Context, controlCh chan string, commandCallback func(string)) {
	slog.Info("AgentController started")
	ticker := time.NewTicker(c.cfg.ScanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("AgentController stopping")
			commandCallback("stopped")
			return
		case <-ticker.C:
			slog.Info("AgentController scanning agents")
			c.scanAgents()
		case cmd := <-controlCh:
			slog.Info("AgentController received command", "command", cmd)
			switch cmd {
			case "stop":
				slog.Info("AgentController stopping")
				commandCallback("stopped")
				return
			default:
				slog.Warn("AgentController received unknown command", "command", cmd)
			}
		}
	}
}

func (c *AgentController) scanAgents() {
	for _, tracking := range c.tracker.GetAllTrackings() {
		agentAwakeDuration := time.Since(tracking.CreatedAt)
		slog.Info("AgentController scanning agent", "agent_id", tracking.AgentID, "created_at", tracking.CreatedAt, "agent_awake_duration", agentAwakeDuration.String())
		if agentAwakeDuration > c.cfg.AgentLifeTime {
			slog.Info("AgentController agent lifetime exceeded", "agent_id", tracking.AgentID, "created_at", tracking.CreatedAt, "agent_awake_duration", agentAwakeDuration.String())
			c.putAgentToSleep(tracking)
		}
	}
}

func (c *AgentController) putAgentToSleep(tracking AgentTracking) {
	slog.Info("AgentController putting agent to sleep", "agent_id", tracking.AgentID)
	tracking.Agent.SendCommand(foundation.CmdTerminate)
	slog.Info("AgentController agent terminated", "agent_id", tracking.AgentID)
	c.tracker.UpdateTracking(tracking.AgentID, AgentTracking{
		AgentID:   tracking.AgentID,
		Agent:     tracking.Agent,
		Status:    tracking.Agent.GetStatus(), // Update agent status
		CreatedAt: tracking.CreatedAt,
	})
}

func newAgent(task string, role string, storage storage.Storage, provider providers.ChatProvider) (agents.Agent, error) {
	switch role {
	case foundation.RolePublisher:
		return agents.NewPublisher(task, storage, provider), nil
	case foundation.RoleConsumer:
		return agents.NewConsumer(task, storage, provider), nil
	default:
		return nil, fmt.Errorf("invalid agent role: %s", role)
	}
}

func (c *AgentController) KickoffTask(ctx context.Context, task string, role string, provider providers.ChatProvider) (string, error) {
	slog.Info("AgentController kicking off task", "task", task, "role", role)
	agent, err := NewAgentFunc(task, role, c.storage, provider)
	if err != nil {
		return "", err
	}

	go func() {
		slog.Info("AgentController starting agent task")
		resp, err := agent.StartTask(ctx, c.onPause, c.onResume, c.onTerminate)
		if err != nil {
			slog.Error("AgentController error starting task", "error", err)
		}
		slog.Info("AgentController writing response to bus", "response", resp)
		c.bus.WriteResponse(resp)
	}()

	slog.Info("AgentController adding agent to tracker", "agent_id", agent.GetID())
	c.tracker.AddTracking(agent.GetID(), AgentTracking{
		AgentID:   agent.GetID(),
		Agent:     agent,
		Status:    "running",
		CreatedAt: time.Now(),
	})

	return agent.GetID(), nil
}

func (c *AgentController) GetAgentStatus(agentID string) (string, error) {
	tracking, ok := c.tracker.GetTracking(agentID)
	if !ok {
		return "", fmt.Errorf("agent not found")
	}
	return tracking.Status, nil
}
