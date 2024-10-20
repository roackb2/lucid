package tools

import (
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
				Name:        openai.String("done"),
				Description: openai.String("Stop the task"),
				Parameters: openai.F(openai.FunctionParameters{
					"type": "object",
					"properties": map[string]interface{}{
						"content": map[string]string{
							"type": "string",
						},
					},
					"required": []string{"content"},
				}),
			}),
		},
	}
	return &FlowTool{toolDefinition: toolDefinition}
}

func (t *FlowTool) GetToolDefinition() []openai.ChatCompletionToolParam {
	return t.toolDefinition
}
