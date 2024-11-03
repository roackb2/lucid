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
	ResumeTask(ctx context.Context, agentID string, newPrompt *string, callbacks worker.WorkerCallbacks) (*AgentResponse, error)
	PersistState() error
	SendCommand(ctx context.Context, command string) error
	GetStatus() string
	Close()
}
