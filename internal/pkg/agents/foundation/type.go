package foundation

type FoundationModel interface {
	Chat(prompt string) (string, error)
	ResumeChat(newPrompt *string) (string, error)
	Serialize() ([]byte, error)
	Deserialize(state []byte) error
}
