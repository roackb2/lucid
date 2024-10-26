package foundation

type ControlCh <-chan string
type ReportCh chan<- string

const (
	CmdPause     = "pause"
	CmdResume    = "resume"
	CmdTerminate = "terminate"
)

const (
	StateRunning    = "running"
	StatePaused     = "paused"
	StateTerminated = "terminated"
)

type FoundationModel interface {
	Chat(prompt string, controlCh ControlCh, reportCh ReportCh) (string, error)
	ResumeChat(newPrompt *string, controlCh ControlCh, reportCh ReportCh) (string, error)
	Serialize() ([]byte, error)
	Deserialize(state []byte) error
	PersistState() error
	RestoreState(agentID string) error
}
