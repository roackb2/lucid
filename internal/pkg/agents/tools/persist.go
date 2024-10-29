package tools

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type PersistTool struct {
	storage storage.Storage
}

func NewPersistTool(storage storage.Storage) *PersistTool {
	return &PersistTool{storage: storage}
}

func (t *PersistTool) saveContentImpl(arguments string) string {
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

func (t *PersistTool) SaveContent(toolCall providers.ToolCall) string {
	return t.saveContentImpl(toolCall.Args)
}

func (t *PersistTool) searchContentImpl(arguments string) string {
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

func (t *PersistTool) SearchContent(toolCall providers.ToolCall) string {
	return t.searchContentImpl(toolCall.Args)
}
