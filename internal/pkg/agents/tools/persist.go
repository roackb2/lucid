package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/openai/openai-go"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
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

func (t *PersistTool) saveContentImpl(ctx context.Context, arguments string) string {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(arguments), &args)
	if err != nil {
		slog.Error("Persist tool: SaveContent", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}

	content := args["content"].(string)
	err = t.storage.SavePost(content)
	if err != nil {
		slog.Error("Persist tool: SaveContent", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}
	slog.Info("Persist tool: SaveContent", "content", content)
	return fmt.Sprintf("Content saved successfully. (content total length: %d)", len(content))
}

func (t *PersistTool) SaveContent(ctx context.Context, toolCall openai.ChatCompletionMessageToolCall) string {
	return t.saveContentImpl(ctx, toolCall.Function.Arguments)
}

func (t *PersistTool) SaveContentForProvider(ctx context.Context, toolCall providers.ToolCall) string {
	return t.saveContentImpl(ctx, toolCall.Args)
}

func (t *PersistTool) searchContentImpl(ctx context.Context, arguments string) string {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(arguments), &args)
	if err != nil {
		slog.Error("Persist tool: SearchContent", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}

	query := args["query"].(string)
	content, err := t.storage.SearchPosts(query)
	slog.Info("Persist tool: SearchContent", "query", query, "content", content)
	if err != nil {
		slog.Error("Persist tool: SearchContent", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}

	return fmt.Sprintf("Results Found (separated by comma): %v", strings.Join(content, ", "))
}

func (t *PersistTool) SearchContent(ctx context.Context, toolCall openai.ChatCompletionMessageToolCall) string {
	return t.searchContentImpl(ctx, toolCall.Function.Arguments)
}

func (t *PersistTool) SearchContentForProvider(ctx context.Context, toolCall providers.ToolCall) string {
	return t.searchContentImpl(ctx, toolCall.Args)
}
