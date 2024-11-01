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
