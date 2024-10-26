package agents

import "github.com/roackb2/lucid/internal/pkg/agents/foundation"

type AgentResponse struct {
	Id      string
	Role    string
	Message string
}

type Agent interface {
	GetID() string
	StartTask(controlCh foundation.ControlReceiverCh, reportCh foundation.ReportSenderCh) (*AgentResponse, error)
	PersistState() error
	ResumeTask(agentID string, newPrompt *string, controlCh foundation.ControlReceiverCh, reportCh foundation.ReportSenderCh) (*AgentResponse, error)
}
