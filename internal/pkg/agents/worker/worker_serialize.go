package worker

import (
	"encoding/json"
	"log/slog"
	"time"
)

func (w *WorkerImpl) PersistState() error {
	slog.Info("Worker: Persisting state", "agentID", *w.ID, "role", w.Role)
	state, err := w.Serialize()
	if err != nil {
		slog.Error("Worker: Failed to serialize", "error", err)
		return err
	}
	awakenedAt, asleepAt := w.getStateTimestamps()
	err = w.storage.SaveAgentState(*w.ID, state, w.GetStatus(), w.Role, awakenedAt, asleepAt)
	if err != nil {
		slog.Error("Worker: Failed to save state", "error", err)
		return err
	}
	return nil
}

func (w *WorkerImpl) RestoreState(agentID string) error {
	slog.Info("Worker: Restoring state", "agentID", agentID)
	state, err := w.storage.GetAgentState(agentID)
	if err != nil {
		slog.Error("Worker: Failed to get agent state", "agentID", agentID, "error", err)
		return err
	}
	err = w.Deserialize(state)
	if err != nil {
		slog.Error("Worker: Failed to deserialize state", "agentID", agentID, "error", err)
		return err
	}

	// Awakening agent and update its status accordingly
	awakenedAt, asleepAt := w.getStateTimestamps()
	err = w.storage.SaveAgentState(*w.ID, state, w.GetStatus(), w.Role, awakenedAt, asleepAt)
	if err != nil {
		slog.Error("Worker: Failed to save state", "error", err)
		return err
	}
	return nil
}

func (w *WorkerImpl) getStateTimestamps() (awakenedAt *time.Time, asleepAt *time.Time) {
	status := w.GetStatus()
	if status == StatusRunning {
		now := time.Now()
		awakenedAt = &now
	} else if status == StatusAsleep {
		now := time.Now()
		asleepAt = &now
	}
	return
}

func (w *WorkerImpl) Serialize() ([]byte, error) {
	data, err := json.Marshal(w)
	if err != nil {
		slog.Error("Worker: Failed to serialize", "error", err)
		return nil, err
	}
	return data, nil
}

func (w *WorkerImpl) Deserialize(data []byte) error {
	content := string(data)
	slog.Info("Deserializing Worker", "content", content)

	err := json.Unmarshal(data, &w)
	if err != nil {
		slog.Error("Worker: Failed to deserialize", "error", err)
		return err
	}

	return nil
}
