package agent

import (
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
)

type Consumer struct {
	BaseAgent
}

func NewConsumer(task string, storage storage.Storage, provider providers.ChatProvider, pubSub pubsub.PubSub) *Consumer {
	return &Consumer{
		BaseAgent: NewBaseAgent(storage, task, "consumer", provider, pubSub),
	}
}
