package storage

import (
	"time"

	"github.com/roackb2/lucid/internal/pkg/dbaccess"
)

type Storage interface {
	SavePost(content string) error
	SearchPosts(query string) ([]string, error)
	SaveAgentState(agentID string, state []byte, status string, awakenedAt *time.Time, asleepAt *time.Time) error
	GetAgentState(agentID string) ([]byte, error)
	SearchAgentByAwakeDuration(duration time.Duration) ([]dbaccess.AgentState, error)
	SearchAgentByAsleepDuration(duration time.Duration) ([]dbaccess.AgentState, error)
	Close() error
}
