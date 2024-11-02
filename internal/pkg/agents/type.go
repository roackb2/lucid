package agents

import (
	"context"

	"github.com/roackb2/lucid/internal/pkg/agents/worker"
)

type AgentResponse struct {
	Id      string
	Role    string
	Message string
}

type Agent interface {
	GetID() string
	StartTask(ctx context.Context, callbacks worker.WorkerCallbacks) (*AgentResponse, error)
	PersistState() error
	ResumeTask(ctx context.Context, agentID string, newPrompt *string, callbacks worker.WorkerCallbacks) (*AgentResponse, error)
	GetStatus() string
	SendCommand(command string)
}
