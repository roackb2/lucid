package storage

import (
	"context"
	"log/slog"

	"github.com/roackb2/lucid/internal/pkg/dbaccess"
	"github.com/roackb2/lucid/internal/pkg/querier"
)

type RelationalStorage struct {
	content []string
}

func NewRelationalStorage() *RelationalStorage {
	return &RelationalStorage{}
}

func (m *RelationalStorage) Save(content string) error {
	createPostParams := dbaccess.CreatePostParams{
		UserID:  1,
		Content: content,
	}
	err := querier.Querier.CreatePost(context.Background(), createPostParams)
	if err != nil {
		slog.Error("RelationalStorage: Failed to save content", "error", err)
		return err
	}
	slog.Info("RelationalStorage: Saved content", "content", content)
	return nil
}

func (m *RelationalStorage) Search(query string) ([]string, error) {
	slog.Info("RelationalStorage: Searching for content", "query", query)

	results, err := querier.SearchPosts(query)
	if err != nil {
		slog.Error("RelationalStorage: Failed to search content", "error", err)
		return nil, err
	}

	slog.Info("RelationalStorage: Found content", "results", len(results))
	content := make([]string, len(results))
	for i, post := range results {
		content[i] = post.Content
	}
	return content, nil
}
