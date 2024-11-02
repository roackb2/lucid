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

// ChatProvider is responsible for interacting with the LLM.
// It is used by the Worker to send messages to the LLM and receive responses.
// A ChatProvider is expected to be stateless and thread-safe.
// It converts the chat history into a prompt for every Chat call.
// The conversation history is managed by the Worker, and will be passed in on every Chat call.
type ChatProvider interface {
	Chat(messages []ChatMessage) (ChatResponse, error)
}
