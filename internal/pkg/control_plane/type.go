package control_plane

import (
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
)

// Bus should guarantee thread safety
type NotificationBus interface {
	WriteResponse(resp *agents.AgentResponse) error
	ReadResponse() *agents.AgentResponse
}

type AgentTracking struct {
	AgentID   string
	Agent     agents.Agent
	Status    string
	CreatedAt time.Time
	ControlCh foundation.ControlSenderCh
	ReportCh  foundation.ReportReceiverCh
}

// Tracker should guarantee thread safety
type AgentTracker interface {
	AddTracking(agentID string, tracking AgentTracking)
	GetTracking(agentID string) (AgentTracking, bool)
	UpdateTracking(agentID string, tracking AgentTracking)
	RemoveTracking(agentID string)
	GetAllTrackings() []AgentTracking
}
