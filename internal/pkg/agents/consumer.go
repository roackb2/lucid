package agents

import "github.com/roackb2/lucid/internal/pkg/agents/foundation"

type Consumer struct {
	model foundation.FoundationModel
	task  string
}

func NewConsumer(task string) *Consumer {
	return &Consumer{
		model: foundation.NewFoundationModel(),
		task:  task,
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
