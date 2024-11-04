package control_plane

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents/agent"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

const (
	AgentControllerControlChSize = 10
)

type AgentControllerConfig struct {
	ScanInterval  time.Duration
	AgentLifeTime time.Duration
	MaxRespChSize int
}

type AgentControllerImpl struct {
	cfg AgentControllerConfig

	storage   storage.Storage
	tracker   AgentTracker
	controlCh chan string
	terminate bool
}

func NewAgentController(
	cfg AgentControllerConfig,
	storage storage.Storage,
	tracker AgentTracker,
) *AgentControllerImpl {
	scanInterval := utils.GetOrDefault(cfg.ScanInterval, 1*time.Second)
	agentLifeTime := utils.GetOrDefault(cfg.AgentLifeTime, 5*time.Minute)
	maxRespChSize := utils.GetOrDefault(cfg.MaxRespChSize, 65536)
	mergedCfg := AgentControllerConfig{
		ScanInterval:  scanInterval,
		AgentLifeTime: agentLifeTime,
		MaxRespChSize: maxRespChSize,
	}
	controller := &AgentControllerImpl{
		cfg:       mergedCfg,
		storage:   storage,
		tracker:   tracker,
		controlCh: make(chan string, AgentControllerControlChSize),
		terminate: false,
	}
	return controller
}

func (c *AgentControllerImpl) SendCommand(ctx context.Context, command string) error {
	if c.controlCh == nil {
		slog.Error("AgentController: Control channel not initialized")
		return nil
	}
	select {
	case c.controlCh <- command:
		slog.Info("AgentController: Sent command", "command", command)
		return nil
	case <-ctx.Done():
		return fmt.Errorf("context canceled, cannot send command")
	case <-time.After(3 * time.Second):
		return fmt.Errorf("sending command timed out")
	}
}

func (c *AgentControllerImpl) Start(ctx context.Context) error {
	slog.Info("AgentController started")
	ticker := time.NewTicker(c.cfg.ScanInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("AgentController stopping")
			return ctx.Err()
		case cmd, ok := <-c.controlCh:
			if !ok {
				slog.Error("AgentController control channel closed")
				return fmt.Errorf("control channel closed")
			}
			slog.Info("AgentController received command", "command", cmd)
			switch cmd {
			case "stop":
				slog.Info("AgentController stopping")
				c.terminate = true
			default:
				slog.Warn("AgentController received unknown command", "command", cmd)
				return fmt.Errorf("unknown command: %s", cmd)
			}
		case <-ticker.C:
			slog.Info("AgentController scanning agents")
			allAgentsAsleep, err := c.scanAgents(ctx)
			if err != nil {
				slog.Error("AgentController error scanning agents", "error", err)
			}
			if allAgentsAsleep && c.terminate {
				slog.Info("AgentController all agents are asleep, stopping")
				return nil
			}
		}
	}
}

func (c *AgentControllerImpl) scanAgents(ctx context.Context) (bool, error) {
	allAgentsAsleep := true
	trackings := c.tracker.GetAllTrackings()
	slog.Info("AgentController scanning agents", "num_agents", len(trackings))
	for _, tracking := range trackings {
		status := tracking.Agent.GetStatus()
		slog.Info("AgentController handling agent", "agent_id", tracking.AgentID, "created_at", tracking.CreatedAt, "status", status)
		if status == worker.StatusRunning {
			allAgentsAsleep = false
			agentAwakeDuration := time.Since(tracking.CreatedAt)
			// If we're terminating or agent lifetime exceeded, put agent to sleep
			if c.terminate || agentAwakeDuration > c.cfg.AgentLifeTime {
				slog.Info("AgentController agent lifetime exceeded", "agent_id", tracking.AgentID, "created_at", tracking.CreatedAt, "agent_awake_duration", agentAwakeDuration.String())
				err := c.putAgentToSleep(ctx, tracking)
				if err != nil {
					slog.Error("AgentController error putting agent to sleep", "agent_id", tracking.AgentID, "error", err)
					return false, err
				}
			}
		} else if status == worker.StatusAsleep || status == worker.StatusTerminated {
			slog.Info("AgentController agent is asleep or terminated, removing tracking", "agent_id", tracking.AgentID)
			c.tracker.RemoveTracking(tracking.AgentID)
		}
	}
	return allAgentsAsleep, nil
}

func (c *AgentControllerImpl) putAgentToSleep(ctx context.Context, tracking AgentTracking) error {
	slog.Info("AgentController putting agent to sleep", "agent_id", tracking.AgentID)
	err := tracking.Agent.SendCommand(ctx, worker.CmdSleep)
	if err != nil {
		slog.Error("AgentController error sending command", "agent_id", tracking.AgentID, "error", err)
	}
	slog.Info("AgentController updating tracking", "agent_id", tracking.AgentID)
	c.tracker.UpdateTracking(tracking.AgentID, AgentTracking{
		AgentID: tracking.AgentID,
		Agent:   tracking.Agent,
		// IMPORTANT: Do not call GetStatus() here. This would cause a deadlock cuz SendCommand is changing the status as well.
		Status:    worker.StatusAsleep,
		CreatedAt: tracking.CreatedAt,
	})
	slog.Info("AgentController updated tracking", "agent_id", tracking.AgentID)
	return nil
}

func (c *AgentControllerImpl) RegisterAgent(ctx context.Context, agent agent.Agent) (string, error) {
	slog.Info("AgentController registering agent", "agent_id", agent.GetID())
	c.tracker.AddTracking(agent.GetID(), AgentTracking{
		AgentID:   agent.GetID(),
		Agent:     agent,
		Status:    "running",
		CreatedAt: time.Now(),
	})

	return agent.GetID(), nil
}

func (c *AgentControllerImpl) GetAgentStatus(agentID string) (string, error) {
	tracking, ok := c.tracker.GetTracking(agentID)
	if !ok {
		return "", fmt.Errorf("agent not found")
	}
	return tracking.Status, nil
}
