package agents

import (
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type Consumer struct {
	BaseAgent
}

func NewConsumer(task string, storage storage.Storage, provider providers.ChatProvider) *Consumer {
	return &Consumer{
		BaseAgent: NewBaseAgent(storage, task, "consumer", provider),
	}
}
