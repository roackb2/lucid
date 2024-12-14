package storage

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/pgvector/pgvector-go"
	"github.com/roackb2/lucid/internal/pkg/agents/embedding"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

const (
	DefaultThreshold        = 0.7
	DefaultTrigramThreshold = 0.3
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
	embeddings, err := embedding.Embed(content)
	if err != nil {
		slog.Error("VectorStorage: Failed to embed content", "error", err)
		return err
	}
	embeddingsFloat := embedding.ConvertToFloat32(embeddings)
	createPostParams := dbaccess.CreatePostParams{
		UserID:    1,
		Content:   content,
		Embedding: pgvector.NewVector(embeddingsFloat[0]),
	}
	err = dbaccess.Querier.CreatePost(context.Background(), createPostParams)
	if err != nil {
		slog.Error("RelationalStorage: Failed to save post", "error", err)
		return err
	}
	slog.Info("RelationalStorage: Saved post", "content", content)
	return nil
}

func (m *RelationalStorage) SearchPosts(query string) ([]string, error) {
	slog.Info("RelationalStorage: Searching for posts", "query", query)
	embeddings, err := embedding.Embed(query)
	if err != nil {
		slog.Error("RelationalStorage: Failed to embed query", "error", err)
		return nil, err
	}
	embeddingsFloat := embedding.ConvertToFloat32(embeddings)
	searchParams := dbaccess.SearchPostsParams{
		Keyword:          query,
		Embedding:        pgvector.NewVector(embeddingsFloat[0]),
		Threshold:        DefaultThreshold,
		TrigramThreshold: DefaultTrigramThreshold,
	}
	results, err := dbaccess.Querier.SearchPosts(context.Background(), searchParams)
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

func (m *RelationalStorage) SaveAgentState(agentID string, state []byte, status string, role string, awakenedAt *time.Time, asleepAt *time.Time) error {
	slog.Info("RelationalStorage: Saving agent state", "agentID", agentID, "status", status, "role", role, "awakenedAt", awakenedAt, "asleepAt", asleepAt)
	_, err := dbaccess.Querier.GetAgentState(context.Background(), agentID)
	if err != nil {
		if strings.Contains(err.Error(), "no rows in result set") {
			slog.Info("RelationalStorage: No existing agent state found, creating new state", "agentID", agentID)
			err = m.createAgentState(agentID, state, status, role, awakenedAt, asleepAt)
			if err != nil {
				slog.Error("RelationalStorage: Failed to create agent state", "error", err)
				return err
			}
		} else {
			slog.Error("RelationalStorage: Failed to get existing agent state", "error", err)
			return err
		}
	}
	err = m.updateAgentState(agentID, state, status, role, awakenedAt, asleepAt)
	if err != nil {
		slog.Error("RelationalStorage: Failed to update agent state", "error", err)
		return err
	}
	slog.Info("RelationalStorage: Saved agent state", "agentID", agentID)
	return nil
}

func (m *RelationalStorage) createAgentState(agentID string, state []byte, status string, role string, awakenedAt *time.Time, asleepAt *time.Time) error {
	slog.Info("RelationalStorage: Creating agent state", "agentID", agentID, "status", status, "awakenedAt", awakenedAt, "asleepAt", asleepAt)
	params := dbaccess.CreateAgentStateParams{
		AgentID:    agentID,
		State:      state,
		Status:     status,
		Role:       role,
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

func (m *RelationalStorage) updateAgentState(agentID string, state []byte, status string, role string, awakenedAt *time.Time, asleepAt *time.Time) error {
	slog.Info("RelationalStorage: Updating agent state", "agentID", agentID, "status", status, "awakenedAt", awakenedAt, "asleepAt", asleepAt)

	params := dbaccess.UpdateAgentStateParams{
		AgentID:    agentID,
		State:      state,
		Status:     status,
		Role:       role,
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

func (m *RelationalStorage) createAgentProfile(agentID string, profile []byte) error {
	slog.Info("RelationalStorage: Creating agent profile", "agentID", agentID)
	embeddings, err := embedding.Embed(string(profile))
	if err != nil {
		slog.Error("RelationalStorage: Failed to embed profile", "error", err)
		return err
	}
	embeddingsFloat := embedding.ConvertToFloat32(embeddings)
	params := dbaccess.CreateAgentProfileParams{
		AgentID:   agentID,
		Profile:   string(profile),
		Embedding: pgvector.NewVector(embeddingsFloat[0]),
	}
	err = dbaccess.Querier.CreateAgentProfile(context.Background(), params)
	if err != nil {
		slog.Error("RelationalStorage: Failed to create agent profile", "error", err)
		return err
	}
	return nil
}

func (m *RelationalStorage) updateAgentProfile(agentID string, profile []byte) error {
	slog.Info("RelationalStorage: Updating agent profile", "agentID", agentID)
	embeddings, err := embedding.Embed(string(profile))
	if err != nil {
		slog.Error("RelationalStorage: Failed to embed profile", "error", err)
		return err
	}
	embeddingsFloat := embedding.ConvertToFloat32(embeddings)
	params := dbaccess.UpdateAgentProfileParams{
		AgentID:   agentID,
		Profile:   string(profile),
		Embedding: pgvector.NewVector(embeddingsFloat[0]),
	}
	err = dbaccess.Querier.UpdateAgentProfile(context.Background(), params)
	if err != nil {
		slog.Error("RelationalStorage: Failed to update agent profile", "error", err)
		return err
	}
	return nil
}

func (m *RelationalStorage) SaveAgentProfile(agentID string, profile []byte) error {
	slog.Info("RelationalStorage: Saving agent profile", "agentID", agentID)
	_, err := m.GetAgentProfile(agentID)
	if err != nil {
		if strings.Contains(err.Error(), "no rows in result set") {
			slog.Info("RelationalStorage: No existing agent profile found, creating new profile", "agentID", agentID)
			err = m.createAgentProfile(agentID, profile)
			if err != nil {
				slog.Error("RelationalStorage: Failed to create agent profile", "error", err)
				return err
			}
		} else {
			slog.Error("RelationalStorage: Failed to get existing agent profile", "error", err)
			return err
		}
	}
	err = m.updateAgentProfile(agentID, profile)
	if err != nil {
		slog.Error("RelationalStorage: Failed to update agent profile", "error", err)
		return err
	}
	return nil
}

func (m *RelationalStorage) GetAgentProfile(agentID string) (*AgentProfile, error) {
	slog.Info("RelationalStorage: Getting agent profile", "agentID", agentID)
	profile, err := dbaccess.Querier.GetAgentProfile(context.Background(), agentID)
	if err != nil {
		slog.Error("RelationalStorage: Failed to get agent profile", "error", err)
		return nil, err
	}
	return &AgentProfile{
		AgentID: profile.AgentID,
		Profile: []byte(profile.Profile),
	}, nil
}

func (m *RelationalStorage) SearchAgentProfile(query string) ([]AgentProfile, error) {
	slog.Info("RelationalStorage: Searching agent profile", "query", query)
	embeddings, err := embedding.Embed(query)
	if err != nil {
		slog.Error("RelationalStorage: Failed to embed query", "error", err)
		return nil, err
	}
	embeddingsFloat := embedding.ConvertToFloat32(embeddings)
	results, err := dbaccess.Querier.SearchAgentProfiles(context.Background(), dbaccess.SearchAgentProfilesParams{
		Keyword:          query,
		Embedding:        pgvector.NewVector(embeddingsFloat[0]),
		Threshold:        DefaultThreshold,
		TrigramThreshold: DefaultTrigramThreshold,
	})
	if err != nil {
		slog.Error("RelationalStorage: Failed to search agent profile", "error", err)
		return nil, err
	}
	slog.Info("RelationalStorage: Found agent profiles", "results", len(results))
	profiles := make([]AgentProfile, len(results))
	for i, profile := range results {
		profiles[i] = AgentProfile{
			AgentID: profile.AgentID,
			Profile: []byte(profile.Profile),
		}
	}
	return profiles, nil
}
