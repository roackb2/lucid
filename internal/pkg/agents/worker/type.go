package worker

import "context"

type CommandCallback func(agentID string, status string)

const (
	RolePublisher = "publisher"
	RoleConsumer  = "consumer"
)

const (
	CmdPause  = "pause"
	CmdResume = "resume"
	CmdSleep  = "sleep"
)

const (
	StatusRunning = "running"
	StatusPaused  = "paused"
	StatusAsleep  = "asleep"
)

type WorkerEventKey string

const (
	OnPause  WorkerEventKey = "onPause"
	OnResume WorkerEventKey = "onResume"
	OnSleep  WorkerEventKey = "onSleep"
)

type WorkerCallbacks map[WorkerEventKey]CommandCallback

// Worker is the fundamental component of an agent.
// It is responsible for the agent's behavior and state management.
// Worker's main job includes:
// - Run LLM in a loop until the agent has found some useful information or has been terminated
// - Handle flow control commands from the control plane
// - Manage the agent's internal state, including the chat history and the current task
// - Persist agent state when terminated, and restore state when resumed
type Worker interface {
	Chat(ctx context.Context, prompt string, callbacks WorkerCallbacks) (string, error)
	ResumeChat(ctx context.Context, newPrompt *string, callbacks WorkerCallbacks) (string, error)
	SendCommand(command string)
	Serialize() ([]byte, error)
	Deserialize(state []byte) error
	PersistState() error
	RestoreState(agentID string) error
}
