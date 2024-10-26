package storage

import (
	"context"
	"log/slog"

	"github.com/roackb2/lucid/internal/pkg/dbaccess"
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

func (m *RelationalStorage) SaveAgentState(agentID string, state []byte) error {
	slog.Info("RelationalStorage: Saving agent state", "agentID", agentID)
	params := dbaccess.CreateAgentStateParams{
		AgentID: agentID,
		State:   state,
	}
	err := dbaccess.Querier.CreateAgentState(context.Background(), params)
	if err != nil {
		slog.Error("RelationalStorage: Failed to save agent state", "error", err)
		return err
	}
	slog.Info("RelationalStorage: Saved agent state", "agentID", agentID)
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
