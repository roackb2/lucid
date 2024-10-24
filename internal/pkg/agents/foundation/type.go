package foundation

type FoundationModel interface {
	Chat(prompt string) (string, error)
}
