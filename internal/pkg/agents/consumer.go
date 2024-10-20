package agents

import (
	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type Consumer struct {
	model   foundation.FoundationModel
	storage storage.Storage
	task    string
}

func NewConsumer(task string, storage storage.Storage) *Consumer {
	return &Consumer{
		model:   foundation.NewFoundationModel(),
		storage: storage,
		task:    task,
	}
}

func (c *Consumer) StartTask(ch chan string) (string, error) {
	response, err := c.model.Chat(c.task)
	if err != nil {
		return "", err
	}
	ch <- response
	return response, nil
}
