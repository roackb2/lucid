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
	StartTask(resCh chan AgentResponse, errCh chan error)
	PersistState() error
	RestoreState() error
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

func (b *BaseAgent) StartTask(resCh chan AgentResponse, errCh chan error) {
	slog.Info("Agent: Starting task", "role", b.role, "task", b.task)
	response, err := b.model.Chat(b.task)
	if err != nil {
		errCh <- err
		return
	}
	slog.Info("Agent: Task finished", "role", b.role, "response", response)
	resCh <- AgentResponse{b.id, b.role, response}
}

func (b *BaseAgent) PersistState() error {
	slog.Info("Agent: Persisting state", "agentID", b.id, "role", b.role)
	state, err := b.model.Serialize()
	if err != nil {
		slog.Error("Agent: Failed to serialize state", "agentID", b.id, "role", b.role, "error", err)
		return err
	}
	return b.storage.SaveAgentState(b.id, state)
}

func (b *BaseAgent) RestoreState() error {
	slog.Info("Agent: Restoring state", "agentID", b.id, "role", b.role)
	state, err := b.storage.GetAgentState(b.id)
	if err != nil {
		slog.Error("Agent: Failed to get agent state", "agentID", b.id, "role", b.role, "error", err)
		return err
	}
	return b.model.Deserialize(state)
}
