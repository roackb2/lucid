package providers

type ToolCall struct {
	ID           string `json:"id"`
	FunctionName string `json:"function_name"`
	Args         string `json:"args"`
}

type ChatMessage struct {
	Content  *string   `json:"content"`
	Role     string    `json:"role"`
	ToolCall *ToolCall `json:"tool_call"`
}

type ChatResponse struct {
	Content   *string    `json:"content"`
	Role      string     `json:"role"`
	ToolCalls []ToolCall `json:"tool_calls"`
}

type ChatProvider interface {
	Chat(messages []ChatMessage) (ChatResponse, error)
}
