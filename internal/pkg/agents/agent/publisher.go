package agent

import (
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type Publisher struct {
	BaseAgent
}

func NewPublisher(task string, storage storage.Storage, provider providers.ChatProvider) *Publisher {
	return &Publisher{
		BaseAgent: NewBaseAgent(storage, task, "publisher", provider),
	}
}
