package providers

type ToolCall struct {
	ID           string
	FunctionName string
	Args         string
}

type ChatMessage struct {
	Content  *string
	Role     string
	ToolCall *ToolCall
}

type ChatResponse struct {
	Content   *string
	Role      string
	ToolCalls []ToolCall
}

type ChatProvider interface {
	Chat(messages []ChatMessage) (ChatResponse, error)
	Serialize() (string, error)
	RebuildMessagesFromJsonMap(jsonMap map[string]any) error
}
