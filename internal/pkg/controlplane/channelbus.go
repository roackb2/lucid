package controlplane

import "github.com/roackb2/lucid/internal/pkg/agents"

type ChannelBus struct {
}

func NewChannelBus() *ChannelBus {
	return &ChannelBus{}
}

func (b *ChannelBus) Publish(agentID string, resp *agents.AgentResponse) error {
	return nil
}
