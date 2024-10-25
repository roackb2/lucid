package storage

type Storage interface {
	SavePost(content string) error
	SearchPosts(query string) ([]string, error)
	SaveAgentState(agentID string, state []byte) error
	GetAgentState(agentID string) ([]byte, error)
	Close() error
}
