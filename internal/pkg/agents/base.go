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
	StartTask(controlCh foundation.ControlCh, reportCh foundation.ReportCh) (*AgentResponse, error)
	PersistState() error
	ResumeTask(agentID string, newPrompt *string, controlCh foundation.ControlCh, reportCh foundation.ReportCh) (*AgentResponse, error)
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

func (b *BaseAgent) StartTask(controlCh foundation.ControlCh, reportCh foundation.ReportCh) (*AgentResponse, error) {
	slog.Info("Agent: Starting task", "role", b.role, "task", b.task)
	response, err := b.model.Chat(b.task, controlCh, reportCh)
	if err != nil {
		return nil, err
	}
	slog.Info("Agent: Task finished", "role", b.role, "response", response)
	return &AgentResponse{b.id, b.role, response}, nil
}

func (b *BaseAgent) ResumeTask(agentID string, newPrompt *string, controlCh foundation.ControlCh, reportCh foundation.ReportCh) (*AgentResponse, error) {
	slog.Info("Agent: Resuming task", "agentID", agentID, "role", b.role)
	// Restore the agent state
	err := b.restoreState(agentID)
	if err != nil {
		return nil, err
	}
	// Resume the chat
	response, err := b.model.ResumeChat(newPrompt, controlCh, reportCh)
	if err != nil {
		return nil, err
	}
	return &AgentResponse{b.id, b.role, response}, nil
}

func (b *BaseAgent) PersistState() error {
	slog.Info("Agent: Persisting state", "agentID", b.id, "role", b.role)
	err := b.model.PersistState()
	if err != nil {
		slog.Error("Agent: Failed to persist state", "agentID", b.id, "role", b.role, "error", err)
		return err
	}
	return nil
}

// Do not expose this method, users should use ResumeTask instead
func (b *BaseAgent) restoreState(agentID string) error {
	slog.Info("Agent: Restoring state", "agentID", agentID)
	err := b.model.RestoreState(agentID)
	if err != nil {
		slog.Error("Agent: Failed to restore state", "agentID", agentID, "error", err)
		return err
	}
	return nil
}
