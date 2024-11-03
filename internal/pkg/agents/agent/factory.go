package agent

import (
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type RealAgentFactory struct{}

func (f *RealAgentFactory) NewPublisherAgent(storage storage.Storage, task string, chatProvider providers.ChatProvider) Agent {
	return NewPublisher(task, storage, chatProvider)
}

func (f *RealAgentFactory) NewConsumerAgent(storage storage.Storage, task string, chatProvider providers.ChatProvider) Agent {
	return NewConsumer(task, storage, chatProvider)
}
