package storage

import (
	"time"
)

type AgentProfile struct {
	AgentID string
	Profile []byte
}

type Storage interface {
	SavePost(content string) error
	SearchPosts(query string) ([]string, error)
	SaveAgentState(agentID string, state []byte, status string, role string, awakenedAt *time.Time, asleepAt *time.Time) error
	GetAgentState(agentID string) ([]byte, error)
	SaveAgentProfile(agentID string, profile []byte) error
	GetAgentProfile(agentID string) (*AgentProfile, error)
	SearchAgentProfile(query string) ([]AgentProfile, error)
	Close() error
}
