package control_plane

import "github.com/roackb2/lucid/internal/pkg/agents/agent"

type ChannelBus struct {
	respCh chan *agent.AgentResponse
}

func NewChannelBus(size int) *ChannelBus {
	if size <= 0 {
		size = 65536
	}
	return &ChannelBus{
		respCh: make(chan *agent.AgentResponse, size),
	}
}

func (b *ChannelBus) WriteResponse(resp *agent.AgentResponse) error {
	b.respCh <- resp
	return nil
}

func (b *ChannelBus) ReadResponse() *agent.AgentResponse {
	return <-b.respCh
}
