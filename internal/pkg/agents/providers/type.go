package providers

import "context"

type ToolCall struct {
	ID           string
	FunctionName string
	Args         map[string]interface{}
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
	PrepareMessages(systemPrompt *string, userPrompt *string) error
	Chat() (ChatResponse, error)
	AppendMessage(message ChatMessage) error
	GetMessages() []ChatMessage
	RunTool(ctx context.Context, toolCall ToolCall) string
	Serialize() (string, error)
	RebuildMessagesFromJsonMap(jsonMap map[string]any) error
}
