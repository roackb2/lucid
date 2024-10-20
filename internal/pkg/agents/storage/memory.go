package storage

import "strings"

type MemoryStorage struct {
	content []string
}

func NewMemoryStorage() *MemoryStorage {
	return &MemoryStorage{}
}

func (m *MemoryStorage) Save(content string) {
	m.content = append(m.content, content)
}

func (m *MemoryStorage) Search(query string) []string {
	var results []string
	for _, content := range m.content {
		if strings.Contains(content, query) {
			results = append(results, content)
		}
	}
	return results
}
