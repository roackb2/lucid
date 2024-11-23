package tools

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

type PersistToolImpl struct {
	storage storage.Storage
}

func NewPersistTool(storage storage.Storage) *PersistToolImpl {
	return &PersistToolImpl{storage: storage}
}

func (t *PersistToolImpl) saveContentImpl(arguments string) string {
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

func (t *PersistToolImpl) SaveContent(toolCall providers.ToolCall) string {
	return t.saveContentImpl(toolCall.Args)
}

func (t *PersistToolImpl) searchContentImpl(arguments string) string {
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

func (t *PersistToolImpl) SearchContent(toolCall providers.ToolCall) string {
	return t.searchContentImpl(toolCall.Args)
}

func (t *PersistToolImpl) saveAgentProfileImpl(agentID string, arguments string) string {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(arguments), &args)
	if err != nil {
		slog.Error("Persist tool: SaveAgentProfile", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}

	profile := args["profile"].(string)
	err = t.storage.SaveAgentProfile(agentID, []byte(profile))
	if err != nil {
		slog.Error("Persist tool: SaveAgentProfile", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}
	return "Agent profile saved successfully"
}

func (t *PersistToolImpl) SaveAgentProfile(agentID string, toolCall providers.ToolCall) string {
	return t.saveAgentProfileImpl(agentID, toolCall.Args)
}

func (t *PersistToolImpl) getAgentProfileImpl(arguments string) string {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(arguments), &args)
	if err != nil {
		slog.Error("Persist tool: GetAgentProfile", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}

	agentID := args["agent_id"].(string)
	profile, err := t.storage.GetAgentProfile(agentID)
	if err != nil {
		slog.Error("Persist tool: GetAgentProfile", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}

	res := fmt.Sprintf("Agent ID: %s\nProfile: %s", profile.AgentID, string(profile.Profile))
	slog.Info("Persist tool: GetAgentProfile", "result", res)
	return res
}

func (t *PersistToolImpl) GetAgentProfile(toolCall providers.ToolCall) string {
	return t.getAgentProfileImpl(toolCall.Args)
}

func (t *PersistToolImpl) searchAgentProfileImpl(arguments string) string {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(arguments), &args)
	if err != nil {
		slog.Error("Persist tool: SearchAgentProfile", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}

	query := args["query"].(string)
	profiles, err := t.storage.SearchAgentProfile(query)
	if err != nil {
		slog.Error("Persist tool: SearchAgentProfile", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}

	res := "Results Found (separated by comma):\n"
	for _, profile := range profiles {
		res += fmt.Sprintf("Agent ID: %s\nProfile: %s\n", profile.AgentID, string(profile.Profile))
	}
	return res
}

func (t *PersistToolImpl) SearchAgentProfile(toolCall providers.ToolCall) string {
	return t.searchAgentProfileImpl(toolCall.Args)
}
