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
	DefaultRunningDuration *time.Duration
	MaxRespChSize          int
}

type AgentController struct {
	cfg AgentControllerConfig

	storage  storage.Storage
	tracking map[string]AgentTracking
	bus      NotificationBus
}

type AgentTracking struct {
	AgentID   string
	Agent     *agents.Agent
	CreatedAt time.Time
	ControlCh foundation.ControlSenderCh
	ReportCh  foundation.ReportReceiverCh
}

func NewAgentController(cfg AgentControllerConfig, storage storage.Storage, bus NotificationBus) *AgentController {
	maxRespChSize := cfg.MaxRespChSize
	if maxRespChSize <= 0 {
		maxRespChSize = 65536
	}
	controller := &AgentController{
		cfg:     cfg,
		storage: storage,
		bus:     bus,
	}
	return controller
}

func (c *AgentController) Start() {
	for {
		time.Sleep(1 * time.Second)

		for _, tracking := range c.tracking {
			if time.Since(tracking.CreatedAt) > *c.cfg.DefaultRunningDuration {
				tracking.ControlCh <- foundation.CmdTerminate
			}
		}
	}
}

func (c *AgentController) KickoffTask(ctx context.Context, task string, role string) error {
	var agent agents.Agent
	switch role {
	case foundation.RolePublisher:
		agent = agents.NewPublisher(task, c.storage)
	case foundation.RoleConsumer:
		agent = agents.NewConsumer(task, c.storage)
	default:
		return fmt.Errorf("invalid agent role: %s", role)
	}

	controlCh := make(chan string)
	reportCh := make(chan string)

	go func() {
		resp, err := agent.StartTask(controlCh, reportCh)
		if err != nil {
			slog.Error("Error starting task", "error", err)
		}
		c.bus.Publish(agent.GetID(), resp)
	}()

	c.tracking[agent.GetID()] = AgentTracking{
		AgentID:   agent.GetID(),
		Agent:     &agent,
		ControlCh: controlCh,
		ReportCh:  reportCh,
		CreatedAt: time.Now(),
	}

	return nil
}
