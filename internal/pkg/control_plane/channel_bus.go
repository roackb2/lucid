package control_plane

import "github.com/roackb2/lucid/internal/pkg/agents"

type ChannelBus struct {
	respCh chan *agents.AgentResponse
}

func NewChannelBus(size int) *ChannelBus {
	if size <= 0 {
		size = 65536
	}
	return &ChannelBus{
		respCh: make(chan *agents.AgentResponse, size),
	}
}

func (b *ChannelBus) WriteResponse(resp *agents.AgentResponse) error {
	b.respCh <- resp
	return nil
}

func (b *ChannelBus) ReadResponse() *agents.AgentResponse {
	return <-b.respCh
}
