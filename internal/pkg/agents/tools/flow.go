package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/roackb2/lucid/internal/pkg/agents/providers"
)

type FlowTool struct {
}

func NewFlowTool() *FlowTool {
	return &FlowTool{}
}

func (t *FlowTool) reportImpl(ctx context.Context, arguments string) string {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(arguments), &args)
	if err != nil {
		slog.Error("Flow tool: Report", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}

	content := args["content"].(string)
	slog.Info("Flow tool: Report", "content", content)
	return content
}

func (t *FlowTool) Report(ctx context.Context, toolCall providers.ToolCall) string {
	return t.reportImpl(ctx, toolCall.Args)
}

func (t *FlowTool) waitImpl(ctx context.Context, arguments string) string {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(arguments), &args)
	if err != nil {
		slog.Error("Flow tool: Wait", "error", err)
		return fmt.Sprintf("Error: %v", err)
	}
	duration := args["duration"].(float64)
	slog.Info("Flow tool: Wait", "duration", duration)
	return fmt.Sprintf("Waiting for %f seconds before continuing the task", duration)
}

func (t *FlowTool) Wait(ctx context.Context, toolCall providers.ToolCall) string {
	return t.waitImpl(ctx, toolCall.Args)
}
