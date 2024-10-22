package agents

type AgentResponse struct {
	Id      string
	Role    string
	Message string
}

type Agent interface {
	StartTask(resCh chan AgentResponse, errCh chan error)
}
