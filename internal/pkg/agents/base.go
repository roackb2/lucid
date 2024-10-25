package agents

import (
	"log/slog"

	"github.com/google/uuid"
	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type AgentResponse struct {
	Id      string
	Role    string
	Message string
}

type Agent interface {
	GetID() string
	StartTask() (*AgentResponse, error)
	PersistState() error
	ResumeTask(agentID string, newPrompt *string) (*AgentResponse, error)
}

type BaseAgent struct {
	id      string
	role    string
	model   foundation.FoundationModel
	storage storage.Storage
	task    string
}

func NewBaseAgent(storage storage.Storage, task string, role string) BaseAgent {
	id := uuid.New().String()
	return BaseAgent{
		id:      id,
		role:    role,
		model:   foundation.NewFoundationModel(&id, role, storage),
		storage: storage,
		task:    task,
	}
}

func (b *BaseAgent) GetID() string {
	return b.id
}

func (b *BaseAgent) StartTask() (*AgentResponse, error) {
	slog.Info("Agent: Starting task", "role", b.role, "task", b.task)
	response, err := b.model.Chat(b.task)
	if err != nil {
		return nil, err
	}
	slog.Info("Agent: Task finished", "role", b.role, "response", response)
	return &AgentResponse{b.id, b.role, response}, nil
}

func (b *BaseAgent) ResumeTask(agentID string, newPrompt *string) (*AgentResponse, error) {
	slog.Info("Agent: Resuming task", "agentID", agentID, "role", b.role)
	// Restore the agent state
	err := b.restoreState(agentID)
	if err != nil {
		return nil, err
	}
	// Resume the chat
	response, err := b.model.ResumeChat(newPrompt)
	if err != nil {
		return nil, err
	}
	return &AgentResponse{b.id, b.role, response}, nil
}

func (b *BaseAgent) PersistState() error {
	slog.Info("Agent: Persisting state", "agentID", b.id, "role", b.role)
	state, err := b.model.Serialize()
	if err != nil {
		slog.Error("Agent: Failed to serialize state", "agentID", b.id, "role", b.role, "error", err)
		return err
	}
	err = b.storage.SaveAgentState(b.id, state)
	if err != nil {
		slog.Error("Agent: Failed to save state", "agentID", b.id, "role", b.role, "error", err)
		return err
	}
	return nil
}

func (b *BaseAgent) restoreState(agentID string) error {
	slog.Info("Agent: Restoring state", "agentID", agentID)
	state, err := b.storage.GetAgentState(agentID)
	if err != nil {
		slog.Error("Agent: Failed to get agent state", "agentID", agentID, "error", err)
		return err
	}
	err = b.model.Deserialize(state)
	if err != nil {
		slog.Error("Agent: Failed to deserialize state", "agentID", agentID, "error", err)
		return err
	}
	return nil
}
