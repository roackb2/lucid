package controlplane

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
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
}

func NewAgentController(cfg AgentControllerConfig, storage storage.Storage, bus NotificationBus) *AgentController {
	scanInterval := cfg.ScanInterval
	if scanInterval == 0 {
		scanInterval = (1 * time.Second)
	}
	agentLifeTime := cfg.AgentLifeTime
	if agentLifeTime == 0 {
		agentLifeTime = (5 * time.Minute)
	}
	maxRespChSize := cfg.MaxRespChSize
	if maxRespChSize <= 0 {
		maxRespChSize = 65536
	}
	mergedCfg := AgentControllerConfig{
		ScanInterval:  scanInterval,
		AgentLifeTime: agentLifeTime,
		MaxRespChSize: maxRespChSize,
	}
	controller := &AgentController{
		cfg:     mergedCfg,
		storage: storage,
		bus:     bus,
		tracker: NewMemoryAgentTracker(),
	}
	return controller
}

func (c *AgentController) Start(controlCh chan string, reportCh chan string) {
	slog.Info("AgentController started")
	go func() {
		for {
			time.Sleep(c.cfg.ScanInterval)

			select {
			case cmd := <-controlCh:
				slog.Info("AgentController received command", "command", cmd)
				switch cmd {
				case "stop":
					slog.Info("AgentController stopping")
					reportCh <- "stopped"
					return
				default:
					slog.Warn("AgentController received unknown command", "command", cmd)
				}
			default:
				slog.Info("AgentController scanning agents")
				c.scanAgents()
			}
		}
	}()
}

func (c *AgentController) scanAgents() {
	for _, tracking := range c.tracker.GetAllTrackings() {
		agentAwakeDuration := time.Since(tracking.CreatedAt)
		slog.Info("AgentController scanning agent", "agent_id", tracking.AgentID, "created_at", tracking.CreatedAt, "agent_awake_duration", agentAwakeDuration.String())
		if agentAwakeDuration > c.cfg.AgentLifeTime {
			slog.Info("AgentController agent lifetime exceeded", "agent_id", tracking.AgentID, "created_at", tracking.CreatedAt, "agent_awake_duration", agentAwakeDuration.String())
			// Agent termination might take time, so we put it to sleep in a separate goroutine
			go c.putAgentToSleep(tracking)
		}
	}
}

func (c *AgentController) putAgentToSleep(tracking AgentTracking) {
	slog.Info("AgentController putting agent to sleep", "agent_id", tracking.AgentID)
	tracking.ControlCh <- foundation.CmdTerminate
	status := <-tracking.ReportCh
	slog.Info("AgentController agent terminated", "agent_id", tracking.AgentID, "status", status)
	c.tracker.UpdateTracking(tracking.AgentID, AgentTracking{
		AgentID:   tracking.AgentID,
		Agent:     tracking.Agent,
		Status:    tracking.Agent.GetStatus(), // Update agent status
		ControlCh: tracking.ControlCh,
		ReportCh:  tracking.ReportCh,
		CreatedAt: tracking.CreatedAt,
	})
}

func (c *AgentController) KickoffTask(ctx context.Context, task string, role string) error {
	slog.Info("AgentController kicking off task", "task", task, "role", role)
	var agent agents.Agent
	switch role {
	case foundation.RolePublisher:
		slog.Info("AgentController creating publisher agent")
		agent = agents.NewPublisher(task, c.storage)
	case foundation.RoleConsumer:
		slog.Info("AgentController creating consumer agent")
		agent = agents.NewConsumer(task, c.storage)
	default:
		slog.Error("AgentController invalid agent role", "role", role)
		return fmt.Errorf("invalid agent role: %s", role)
	}

	controlCh := make(chan string)
	reportCh := make(chan string)

	go func() {
		slog.Info("AgentController starting agent task")
		resp, err := agent.StartTask(controlCh, reportCh)
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
		ControlCh: controlCh,
		ReportCh:  reportCh,
		CreatedAt: time.Now(),
	})

	return nil
}
