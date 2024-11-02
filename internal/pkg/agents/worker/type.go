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
	// Start a new chat session
	Chat(ctx context.Context, prompt string, callbacks WorkerCallbacks) (string, error)
	// Resume a chat session
	ResumeChat(ctx context.Context, newPrompt *string, callbacks WorkerCallbacks) (string, error)
	// Send a command to the worker
	SendCommand(command string)
	// Serialize the worker state to a byte slice
	Serialize() ([]byte, error)
	// Deserialize the worker state from a byte slice
	Deserialize(state []byte) error
	// Persist the worker state to the storage
	PersistState() error
	// Restore the worker state from the storage
	RestoreState(agentID string) error
	// Close the worker and release all resources
	Close()
	// Set the control channel. NOTE: This should only be used for testing.
	SetControlCh(ch chan string)
}
