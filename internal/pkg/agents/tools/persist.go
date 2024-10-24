package tools

import (
	"context"
	"encoding/json"

	"github.com/openai/openai-go"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type PersistTool struct {
	storage        storage.Storage
	toolDefinition []openai.ChatCompletionToolParam
}

func NewPersistTool(storage storage.Storage) *PersistTool {
	toolDefinition := []openai.ChatCompletionToolParam{
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
	return &PersistTool{storage: storage, toolDefinition: toolDefinition}
}

func (t *PersistTool) GetToolDefinition() []openai.ChatCompletionToolParam {
	return t.toolDefinition
}

func (t *PersistTool) SaveContent(ctx context.Context, toolCall openai.ChatCompletionMessageToolCall) error {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(toolCall.Function.Arguments), &args)
	if err != nil {
		return err
	}

	content := args["content"].(string)
	return t.storage.SavePost(content)
}

func (t *PersistTool) SearchContent(ctx context.Context, toolCall openai.ChatCompletionMessageToolCall) ([]string, error) {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(toolCall.Function.Arguments), &args)
	if err != nil {
		return nil, err
	}

	query := args["query"].(string)
	return t.storage.SearchPosts(query)
}
