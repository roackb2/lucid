package agents

import (
	"context"

	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
)

type AgentResponse struct {
	Id      string
	Role    string
	Message string
}

type Agent interface {
	GetID() string
	StartTask(
		ctx context.Context,
		onPause foundation.CommandCallback, onResume foundation.CommandCallback, onTerminate foundation.CommandCallback,
	) (*AgentResponse, error)
	PersistState() error
	ResumeTask(
		ctx context.Context, agentID string, newPrompt *string,
		onPause foundation.CommandCallback, onResume foundation.CommandCallback, onTerminate foundation.CommandCallback,
	) (*AgentResponse, error)
	GetStatus() string
	SendCommand(command string)
}
