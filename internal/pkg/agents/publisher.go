package agents

import (
	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type Publisher struct {
	model   foundation.FoundationModel
	storage storage.Storage
	task    string
}

func NewPublisher(task string, storage storage.Storage) *Publisher {
	return &Publisher{
		model:   foundation.NewFoundationModel(),
		storage: storage,
		task:    task,
	}
}

func (p *Publisher) StartTask(ch chan string) (string, error) {
	response, err := p.model.Chat(p.task)
	if err != nil {
		return "", err
	}
	ch <- response
	return response, nil
}
