package control_plane

import (
	"context"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
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

type AgentController interface {
	Start(ctx context.Context) error
	SendCommand(ctx context.Context, command string) error
	RegisterAgent(ctx context.Context, agent agents.Agent) (string, error)
	GetAgentStatus(agentID string) (string, error)
}

type OnAgentFoundCallback func(agentID string, agent dbaccess.AgentState)

type Scheduler interface {
	Start(ctx context.Context) error
	SendCommand(ctx context.Context, command string) error
	SetCallback(callback OnAgentFoundCallback)
}

type AgentFactory interface {
	NewPublisher(storage storage.Storage, task string, chatProvider providers.ChatProvider) agents.Agent
	NewConsumer(storage storage.Storage, task string, chatProvider providers.ChatProvider) agents.Agent
}

type OnAgentFinalResponseCallback func(agentID string, response string)

type ControlPlaneEventKey string

const (
	ControlPlaneEventAgentFinalResponse ControlPlaneEventKey = "agent_final_response"
)

type ControlPlaneCallbacks map[ControlPlaneEventKey]OnAgentFinalResponseCallback

type ControlPlane interface {
	Start(ctx context.Context) error
	KickoffTask(ctx context.Context, task string, role string) error
	SendCommand(ctx context.Context, command string, payload string) error
}
