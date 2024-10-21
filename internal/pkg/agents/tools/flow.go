package tools

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/openai/openai-go"
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

func (t *FlowTool) Report(ctx context.Context, toolCall openai.ChatCompletionMessageToolCall) (string, error) {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(toolCall.Function.Arguments), &args)
	if err != nil {
		return "", err
	}

	content := args["content"].(string)
	slog.Info("Flow tool: Report", "content", content)
	return content, nil
}

func (t *FlowTool) Wait(ctx context.Context, toolCall openai.ChatCompletionMessageToolCall) (float64, error) {
	var args map[string]interface{}
	err := json.Unmarshal([]byte(toolCall.Function.Arguments), &args)
	if err != nil {
		return -1, err
	}
	duration := args["duration"].(float64)
	slog.Info("Flow tool: Wait", "duration", duration)
	return duration, nil
}
