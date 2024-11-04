package agent

import (
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
)

type RealAgentFactory struct{}

func (f *RealAgentFactory) NewPublisherAgent(storage storage.Storage, task string, chatProvider providers.ChatProvider, pubSub pubsub.PubSub) Agent {
	return NewPublisher(task, storage, chatProvider, pubSub)
}

func (f *RealAgentFactory) NewConsumerAgent(storage storage.Storage, task string, chatProvider providers.ChatProvider, pubSub pubsub.PubSub) Agent {
	return NewConsumer(task, storage, chatProvider, pubSub)
}
