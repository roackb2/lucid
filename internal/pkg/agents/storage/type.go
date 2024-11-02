package storage

import (
	"time"
)

type Storage interface {
	SavePost(content string) error
	SearchPosts(query string) ([]string, error)
	SaveAgentState(agentID string, state []byte, status string, awakenedAt *time.Time, asleepAt *time.Time) error
	GetAgentState(agentID string) ([]byte, error)
	Close() error
}
