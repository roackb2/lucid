package storage

import (
	"fmt"
	"log/slog"
	"strings"
)

type MemoryStorage struct {
	content     []string
	agentStates map[string]string
}

func NewMemoryStorage() *MemoryStorage {
	return &MemoryStorage{}
}

func (m *MemoryStorage) SavePost(content string) error {
	m.content = append(m.content, content)
	slog.Info("MemoryStorage: Saved content", "content", content)
	return nil
}

func (m *MemoryStorage) SearchPosts(query string) ([]string, error) {
	slog.Info("MemoryStorage: Searching for content", "query", query)
	var results []string
	for _, content := range m.content {
		if strings.Contains(content, query) {
			results = append(results, content)
		}
	}
	slog.Info("MemoryStorage: Found posts", "results", results)
	return results, nil
}

func (m *MemoryStorage) SaveAgentState(agentID string, state []byte) error {
	m.agentStates[agentID] = string(state)
	return nil
}

func (m *MemoryStorage) GetAgentState(agentID string) ([]byte, error) {
	state, ok := m.agentStates[agentID]
	if !ok {
		return nil, fmt.Errorf("agent state not found")
	}
	return []byte(state), nil
}

func (m *MemoryStorage) Close() error {
	return nil
}
