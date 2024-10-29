package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/openai/openai-go"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
)

type FlowTool struct {
	toolDefinition []openai.ChatCompletionToolParam
}

func NewFlowTool() *FlowTool {
	toolDefinition := []openai.ChatCompletionToolParam{
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
	return &FlowTool{toolDefinition: toolDefinition}
}

func (t *FlowTool) GetToolDefinition() []openai.ChatCompletionToolParam {
	return t.toolDefinition
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

func (t *FlowTool) Report(ctx context.Context, toolCall openai.ChatCompletionMessageToolCall) string {
	return t.reportImpl(ctx, toolCall.Function.Arguments)
}

func (t *FlowTool) ReportForProvider(ctx context.Context, toolCall providers.ToolCall) string {
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

func (t *FlowTool) Wait(ctx context.Context, toolCall openai.ChatCompletionMessageToolCall) string {
	return t.waitImpl(ctx, toolCall.Function.Arguments)
}

func (t *FlowTool) WaitForProvider(ctx context.Context, toolCall providers.ToolCall) string {
	return t.waitImpl(ctx, toolCall.Args)
}
