package controlplane

import (
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
)

type NotificationBus interface {
	Publish(agentID string, resp *agents.AgentResponse) error
}

type AgentTracking struct {
	AgentID   string
	Agent     *agents.Agent
	CreatedAt time.Time
	ControlCh foundation.ControlSenderCh
	ReportCh  foundation.ReportReceiverCh
}

type AgentTracker interface {
	AddTracking(agentID string, tracking AgentTracking)
	GetTracking(agentID string) (AgentTracking, bool)
	UpdateTracking(agentID string, tracking AgentTracking)
	RemoveTracking(agentID string)
	GetAllTrackings() []AgentTracking
}
