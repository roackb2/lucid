package agent

import (
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
)

type RealAgentFactory struct{}

func (f *RealAgentFactory) NewPublisherAgent(cfg worker.WorkerConfig, storage storage.Storage, task string, chatProvider providers.ChatProvider, pubSub pubsub.PubSub) Agent {
	return NewPublisher(cfg, task, storage, chatProvider, pubSub)
}

func (f *RealAgentFactory) NewConsumerAgent(cfg worker.WorkerConfig, storage storage.Storage, task string, chatProvider providers.ChatProvider, pubSub pubsub.PubSub) Agent {
	return NewConsumer(cfg, task, storage, chatProvider, pubSub)
}
