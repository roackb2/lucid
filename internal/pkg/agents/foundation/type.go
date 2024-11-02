package foundation

import "context"

type CommandCallback func(string)

const (
	RolePublisher = "publisher"
	RoleConsumer  = "consumer"
)

const (
	CmdPause     = "pause"
	CmdResume    = "resume"
	CmdTerminate = "terminate"
)

const (
	StatusRunning    = "running"
	StatusPaused     = "paused"
	StatusTerminated = "terminated"
)

// Worker is the fundamental component of an agent.
// It is responsible for the agent's behavior and state management.
// Worker's main job includes:
// - Run LLM in a loop until the agent has found some useful information or has been terminated
// - Handle flow control commands from the control plane
// - Manage the agent's internal state, including the chat history and the current task
// - Persist agent state when terminated, and restore state when resumed
type Worker interface {
	Chat(
		ctx context.Context, prompt string,
		onPause CommandCallback, onResume CommandCallback, onTerminate CommandCallback,
	) (string, error)
	ResumeChat(
		ctx context.Context, newPrompt *string,
		onPause CommandCallback, onResume CommandCallback, onTerminate CommandCallback,
	) (string, error)
	SendCommand(command string)
	Serialize() ([]byte, error)
	Deserialize(state []byte) error
	PersistState() error
	RestoreState(agentID string) error
	GetStatus() string
}
