package storage

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/roackb2/lucid/internal/pkg/dbaccess"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

type RelationalStorage struct{}

func NewRelationalStorage() (*RelationalStorage, error) {
	err := dbaccess.Initialize()
	if err != nil {
		slog.Error("RelationalStorage: Failed to initialize querier", "error", err)
		return nil, err
	}
	return &RelationalStorage{}, nil
}

func (m *RelationalStorage) Close() error {
	dbaccess.Close()
	return nil
}

func (m *RelationalStorage) SavePost(content string) error {
	createPostParams := dbaccess.CreatePostParams{
		UserID:  1,
		Content: content,
	}
	err := dbaccess.Querier.CreatePost(context.Background(), createPostParams)
	if err != nil {
		slog.Error("RelationalStorage: Failed to save post", "error", err)
		return err
	}
	slog.Info("RelationalStorage: Saved post", "content", content)
	return nil
}

func (m *RelationalStorage) SearchPosts(query string) ([]string, error) {
	slog.Info("RelationalStorage: Searching for posts", "query", query)

	results, err := dbaccess.SearchPosts(query)
	if err != nil {
		slog.Error("RelationalStorage: Failed to search posts", "error", err)
		return nil, err
	}

	slog.Info("RelationalStorage: Found posts", "results", len(results))
	content := make([]string, len(results))
	for i, post := range results {
		content[i] = post.Content
	}
	return content, nil
}

func (m *RelationalStorage) SaveAgentState(agentID string, state []byte, status string, awakenedAt *time.Time, asleepAt *time.Time) error {
	slog.Info("RelationalStorage: Saving agent state", "agentID", agentID, "status", status, "awakenedAt", awakenedAt, "asleepAt", asleepAt)
	_, err := dbaccess.Querier.GetAgentState(context.Background(), agentID)
	if err != nil {
		if strings.Contains(err.Error(), "no rows in result set") {
			slog.Info("RelationalStorage: No existing agent state found, creating new state", "agentID", agentID)
			err = m.createAgentState(agentID, state, status, awakenedAt, asleepAt)
			if err != nil {
				slog.Error("RelationalStorage: Failed to create agent state", "error", err)
				return err
			}
		} else {
			slog.Error("RelationalStorage: Failed to get existing agent state", "error", err)
			return err
		}
	}
	err = m.updateAgentState(agentID, state, status, awakenedAt, asleepAt)
	if err != nil {
		slog.Error("RelationalStorage: Failed to update agent state", "error", err)
		return err
	}
	slog.Info("RelationalStorage: Saved agent state", "agentID", agentID)
	return nil
}

func (m *RelationalStorage) createAgentState(agentID string, state []byte, status string, awakenedAt *time.Time, asleepAt *time.Time) error {
	slog.Info("RelationalStorage: Creating agent state", "agentID", agentID, "status", status, "awakenedAt", awakenedAt, "asleepAt", asleepAt)
	params := dbaccess.CreateAgentStateParams{
		AgentID:    agentID,
		State:      state,
		Status:     status,
		AwakenedAt: utils.ConvertToPgTimestamp(awakenedAt),
		AsleepAt:   utils.ConvertToPgTimestamp(asleepAt),
	}
	err := dbaccess.Querier.CreateAgentState(context.Background(), params)
	if err != nil {
		slog.Error("RelationalStorage: Failed to save agent state", "error", err)
		return err
	}
	slog.Info("RelationalStorage: Created agent state", "agentID", agentID)
	return nil
}

func (m *RelationalStorage) updateAgentState(agentID string, state []byte, status string, awakenedAt *time.Time, asleepAt *time.Time) error {
	slog.Info("RelationalStorage: Updating agent state", "agentID", agentID, "status", status, "awakenedAt", awakenedAt, "asleepAt", asleepAt)

	params := dbaccess.UpdateAgentStateParams{
		AgentID:    agentID,
		State:      state,
		Status:     status,
		AwakenedAt: utils.ConvertToPgTimestamp(awakenedAt),
		AsleepAt:   utils.ConvertToPgTimestamp(asleepAt),
	}
	err := dbaccess.Querier.UpdateAgentState(context.Background(), params)
	if err != nil {
		slog.Error("RelationalStorage: Failed to update agent state", "error", err)
		return err
	}
	slog.Info("RelationalStorage: Updated agent state", "agentID", agentID)
	return nil
}

func (m *RelationalStorage) GetAgentState(agentID string) ([]byte, error) {
	slog.Info("RelationalStorage: Getting agent state", "agentID", agentID)
	state, err := dbaccess.Querier.GetAgentState(context.Background(), agentID)
	if err != nil {
		slog.Error("RelationalStorage: Failed to get agent state", "error", err)
		return nil, err
	}
	slog.Info("RelationalStorage: Got agent state", "agentID", agentID)
	return state.State, nil
}
func (m *RelationalStorage) SearchAgentByAwakeDuration(duration time.Duration) ([]dbaccess.AgentState, error) {
	slog.Info("RelationalStorage: Searching for agents by awake duration", "duration", duration)
	cutoff := time.Now().Add(-duration)
	agents, err := dbaccess.Querier.SearchAgentByAwakeDuration(context.Background(), utils.ConvertToPgTimestamp(&cutoff))
	if err != nil {
		slog.Error("RelationalStorage: Failed to search for agents by awake duration", "error", err)
		return nil, err
	}
	return agents, nil
}

func (m *RelationalStorage) SearchAgentByAsleepDuration(duration time.Duration) ([]dbaccess.AgentState, error) {
	slog.Info("RelationalStorage: Searching for agents by asleep duration", "duration", duration)
	cutoff := time.Now().Add(-duration)
	agents, err := dbaccess.Querier.SearchAgentByAsleepDuration(context.Background(), utils.ConvertToPgTimestamp(&cutoff))
	if err != nil {
		slog.Error("RelationalStorage: Failed to search for agents by asleep duration", "error", err)
		return nil, err
	}
	return agents, nil
}
