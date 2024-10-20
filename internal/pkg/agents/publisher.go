package agents

import "github.com/roackb2/lucid/internal/pkg/agents/foundation"

type Publisher struct {
	model foundation.FoundationModel
	task  string
}

func NewPublisher(task string) *Publisher {
	return &Publisher{
		model: foundation.NewFoundationModel(),
		task:  task,
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
