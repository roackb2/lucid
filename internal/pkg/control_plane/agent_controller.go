package control_plane

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents"
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
	bus       NotificationBus
	controlCh chan string

	callbacks worker.WorkerCallbacks
}

func NewAgentController(cfg AgentControllerConfig, storage storage.Storage, bus NotificationBus, tracker AgentTracker) *AgentControllerImpl {
	scanInterval := utils.GetOrDefault(cfg.ScanInterval, 1*time.Second)
	agentLifeTime := utils.GetOrDefault(cfg.AgentLifeTime, 5*time.Minute)
	maxRespChSize := utils.GetOrDefault(cfg.MaxRespChSize, 65536)
	mergedCfg := AgentControllerConfig{
		ScanInterval:  scanInterval,
		AgentLifeTime: agentLifeTime,
		MaxRespChSize: maxRespChSize,
	}
	// TODO: Report status to the caller
	callbacks := worker.WorkerCallbacks{
		worker.OnPause: func(agentID string, status string) {
			slog.Info("AgentController onPause", "agentID", agentID, "status", status)
		},
		worker.OnResume: func(agentID string, status string) {
			slog.Info("AgentController onResume", "agentID", agentID, "status", status)
		},
		worker.OnSleep: func(agentID string, status string) {
			slog.Info("AgentController onSleep", "agentID", agentID, "status", status)
		},
	}
	controller := &AgentControllerImpl{
		cfg:       mergedCfg,
		storage:   storage,
		bus:       bus,
		tracker:   tracker,
		controlCh: make(chan string, AgentControllerControlChSize),
		callbacks: callbacks,
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
	case <-time.After(1 * time.Second):
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
				return nil
			default:
				slog.Warn("AgentController received unknown command", "command", cmd)
				return fmt.Errorf("unknown command: %s", cmd)
			}
		case <-ticker.C:
			slog.Info("AgentController scanning agents")
			err := c.scanAgents(ctx)
			if err != nil {
				slog.Error("AgentController error scanning agents", "error", err)
			}
		}
	}
}

func (c *AgentControllerImpl) scanAgents(ctx context.Context) error {
	for _, tracking := range c.tracker.GetAllTrackings() {
		agentAwakeDuration := time.Since(tracking.CreatedAt)
		slog.Info("AgentController scanning agent", "agent_id", tracking.AgentID, "created_at", tracking.CreatedAt, "agent_awake_duration", agentAwakeDuration.String())
		if agentAwakeDuration > c.cfg.AgentLifeTime {
			slog.Info("AgentController agent lifetime exceeded", "agent_id", tracking.AgentID, "created_at", tracking.CreatedAt, "agent_awake_duration", agentAwakeDuration.String())
			err := c.putAgentToSleep(ctx, tracking)
			if err != nil {
				slog.Error("AgentController error putting agent to sleep", "agent_id", tracking.AgentID, "error", err)
				return err
			}
		}
		// TODO: Delete tracking if agent is asleep
	}
	return nil
}

func (c *AgentControllerImpl) putAgentToSleep(ctx context.Context, tracking AgentTracking) error {
	slog.Info("AgentController putting agent to sleep", "agent_id", tracking.AgentID)
	// TODO: Handle sending command timeout issue
	err := tracking.Agent.SendCommand(ctx, worker.CmdSleep)
	if err != nil {
		slog.Error("AgentController error sending command", "agent_id", tracking.AgentID, "error", err)
	}
	slog.Info("AgentController agent terminated", "agent_id", tracking.AgentID)
	c.tracker.UpdateTracking(tracking.AgentID, AgentTracking{
		AgentID: tracking.AgentID,
		Agent:   tracking.Agent,
		// Assume agent status running cuz shutting down would take a while
		// IMPORTANT: Do not call GetStatus() here. This would cause a deadlock cuz SendCommand is changing the status as well.
		Status:    worker.StatusRunning,
		CreatedAt: tracking.CreatedAt,
	})
	slog.Info("AgentController updated tracking", "agent_id", tracking.AgentID)
	return nil
}

func (c *AgentControllerImpl) RegisterAgent(ctx context.Context, agent agents.Agent) (string, error) {
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
