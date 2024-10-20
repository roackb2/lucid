package storage

import (
	"log/slog"
	"strings"
)

type MemoryStorage struct {
	content []string
}

func NewMemoryStorage() *MemoryStorage {
	return &MemoryStorage{}
}

func (m *MemoryStorage) Save(content string) {
	m.content = append(m.content, content)
	slog.Info("MemoryStorage: Saved content", "content", content)
}

func (m *MemoryStorage) Search(query string) []string {
	slog.Info("MemoryStorage: Searching for content", "query", query)
	var results []string
	for _, content := range m.content {
		if strings.Contains(content, query) {
			results = append(results, content)
		}
	}
	slog.Info("MemoryStorage: Found content", "results", results)
	return results
}
