package agents

import (
	"log/slog"

	"github.com/google/uuid"
	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type Consumer struct {
	id      string
	model   foundation.FoundationModel
	storage storage.Storage
	task    string
}

func NewConsumer(task string, storage storage.Storage) *Consumer {
	return &Consumer{
		id:      uuid.New().String(),
		model:   foundation.NewFoundationModel("consumer", storage),
		storage: storage,
		task:    task,
	}
}

func (c *Consumer) StartTask(resCh chan AgentResponse, errCh chan error) {
	slog.Info("Consumer: Starting task", "task", c.task)
	response, err := c.model.Chat(c.task)
	if err != nil {
		errCh <- err
		return
	}
	slog.Info("Consumer: Task finished", "response", response)
	resCh <- AgentResponse{c.id, "consumer", response}
}
