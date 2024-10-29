package providers

import (
	"context"
	"log/slog"

	"github.com/openai/openai-go"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

var (
	flowToolDefinition = []openai.ChatCompletionToolParam{
		{
			Type: openai.F(openai.ChatCompletionToolTypeFunction),
			Function: openai.F(openai.FunctionDefinitionParam{
				Name:        openai.String("report"),
				Description: openai.String("Finish the task and report the results to the user"),
				Parameters: openai.F(openai.FunctionParameters{
					"type": "object",
					"properties": map[string]interface{}{
						"content": map[string]string{
							"type":        "string",
							"description": "The content of your findings to report to the user",
						},
					},
					"required": []string{"content"},
				}),
			}),
		},
		{
			Type: openai.F(openai.ChatCompletionToolTypeFunction),
			Function: openai.F(openai.FunctionDefinitionParam{
				Name:        openai.String("wait"),
				Description: openai.String("Wait for a period of time before continuing the task"),
				Parameters: openai.F(openai.FunctionParameters{
					"type": "object",
					"properties": map[string]interface{}{
						"duration": map[string]string{
							"type":        "integer",
							"description": "The duration of time to wait in seconds",
						},
					},
					"required": []string{"duration"},
				}),
			}),
		},
	}
	persistToolDefinition = []openai.ChatCompletionToolParam{
		{
			Type: openai.F(openai.ChatCompletionToolTypeFunction),
			Function: openai.F(openai.FunctionDefinitionParam{
				Name:        openai.String("save_content"),
				Description: openai.String("Save the content to the storage"),
				Parameters: openai.F(openai.FunctionParameters{
					"type": "object",
					"properties": map[string]interface{}{
						"content": map[string]string{
							"type":        "string",
							"description": "The content to save to the storage",
						},
					},
					"required": []string{"content"},
				}),
			}),
		},
		{
			Type: openai.F(openai.ChatCompletionToolTypeFunction),
			Function: openai.F(openai.FunctionDefinitionParam{
				Name:        openai.String("search_content"),
				Description: openai.String("Search the content in the storage."),
				Parameters: openai.F(openai.FunctionParameters{
					"type": "object",
					"properties": map[string]interface{}{
						"query": map[string]string{
							"type":        "string",
							"description": "The query to search the content in the storage, currently only supports PostgreSQL SIMILARITY SEARCH. Keep the query as simple as possible, best to be a single word.",
						},
					},
					"required": []string{"query"},
				}),
			}),
		},
	}
)

type OpenAIChatProvider struct {
	Client *openai.Client
	Model  string
}

func NewOpenAIChatProvider(client *openai.Client) *OpenAIChatProvider {
	return &OpenAIChatProvider{
		Client: client,
		Model:  openai.ChatModelGPT4o,
	}
}

func (p *OpenAIChatProvider) Chat(messages []ChatMessage) (ChatResponse, error) {
	respMessage, err := p.chatCompletion(context.Background(), messages)
	if err != nil {
		return ChatResponse{}, err
	}

	resp := p.convertToChatResponse(respMessage)
	return resp, nil
}

func (p *OpenAIChatProvider) assembleChatParams(messages []ChatMessage) openai.ChatCompletionNewParams {
	tools := append(persistToolDefinition, flowToolDefinition...)
	convertedMessages := p.convertFromChatMessages(messages)
	return openai.ChatCompletionNewParams{
		Messages: openai.F(convertedMessages),
		Tools:    openai.F(tools),
		Model:    openai.F(p.Model),
	}
}

func (p *OpenAIChatProvider) chatCompletion(ctx context.Context, messages []ChatMessage) (*openai.ChatCompletionMessage, error) {
	chatParams := p.assembleChatParams(messages)
	p.debugStruct("Agent chat params messages", chatParams.Messages)

	chatCompletion, err := p.Client.Chat.Completions.New(ctx, chatParams)
	if err != nil {
		slog.Error("Agent chat error", "error", err)
		return nil, err
	}
	respMessage := chatCompletion.Choices[0].Message

	p.debugStruct("Agent chat completion", chatCompletion)
	return &respMessage, nil
}

func (p *OpenAIChatProvider) convertFromChatMessages(messages []ChatMessage) []openai.ChatCompletionMessageParamUnion {
	convertedMessages := make([]openai.ChatCompletionMessageParamUnion, len(messages))
	for i, msg := range messages {
		convertedMessages[i] = p.convertFromChatMessage(msg)
	}
	return convertedMessages
}

func (p *OpenAIChatProvider) convertFromChatMessage(msg ChatMessage) openai.ChatCompletionMessageParamUnion {
	switch msg.Role {
	case "system":
		return openai.SystemMessage(*msg.Content)
	case "user":
		return openai.UserMessage(*msg.Content)
	case "assistant":
		return openai.AssistantMessage(*msg.Content)
	case "tool":
		return openai.ToolMessage(msg.ToolCall.ID, *msg.Content)
	}
	return nil
}

func (p *OpenAIChatProvider) convertToChatResponse(agentResponse *openai.ChatCompletionMessage) ChatResponse {
	resp := ChatResponse{
		Content: &agentResponse.Content,
	}
	if agentResponse.ToolCalls != nil {
		resp.ToolCalls = make([]ToolCall, len(agentResponse.ToolCalls))
		for i, toolCall := range agentResponse.ToolCalls {
			resp.ToolCalls[i] = ToolCall{
				ID:           toolCall.ID,
				FunctionName: toolCall.Function.Name,
				Args:         toolCall.Function.Arguments,
			}
		}
	}
	return resp
}

func (p *OpenAIChatProvider) debugStruct(title string, v any) {
	slog.Info(title)
	utils.PrintStruct(v)
}

func (p *OpenAIChatProvider) Serialize() (string, error) {
	return "", nil
}

func (p *OpenAIChatProvider) RebuildMessagesFromJsonMap(jsonMap map[string]any) error {
	return nil
}
