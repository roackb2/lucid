package foundation

type ControlSenderCh chan<- string
type ControlReceiverCh <-chan string
type ReportSenderCh chan<- string
type ReportReceiverCh <-chan string

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
	StateRunning    = "running"
	StatePaused     = "paused"
	StateTerminated = "terminated"
)

type FoundationModel interface {
	Chat(prompt string, controlCh ControlReceiverCh, reportCh ReportSenderCh) (string, error)
	ResumeChat(newPrompt *string, controlCh ControlReceiverCh, reportCh ReportSenderCh) (string, error)
	Serialize() ([]byte, error)
	Deserialize(state []byte) error
	PersistState() error
	RestoreState(agentID string) error
	GetStatus() string
}
