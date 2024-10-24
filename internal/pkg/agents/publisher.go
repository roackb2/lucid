package agents

import (
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type Publisher struct {
	BaseAgent
}

func NewPublisher(task string, storage storage.Storage) *Publisher {
	return &Publisher{
		BaseAgent: NewBaseAgent(storage, task, "publisher"),
	}
}
