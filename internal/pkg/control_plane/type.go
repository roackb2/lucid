package control_plane

import (
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents"
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
}

// Tracker should guarantee thread safety
type AgentTracker interface {
	AddTracking(agentID string, tracking AgentTracking)
	GetTracking(agentID string) (AgentTracking, bool)
	UpdateTracking(agentID string, tracking AgentTracking)
	RemoveTracking(agentID string)
	GetAllTrackings() []AgentTracking
}
