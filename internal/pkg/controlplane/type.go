package controlplane

import "github.com/roackb2/lucid/internal/pkg/agents"

type NotificationBus interface {
	Publish(agentID string, resp *agents.AgentResponse) error
}
