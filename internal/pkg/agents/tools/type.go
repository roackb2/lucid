package tools

import "github.com/roackb2/lucid/internal/pkg/agents/providers"

type PersistTool interface {
	SaveContent(toolCall providers.ToolCall) string
	SearchContent(toolCall providers.ToolCall) string
	SaveAgentProfile(toolCall providers.ToolCall) string
	GetAgentProfile(toolCall providers.ToolCall) string
	SearchAgentProfile(toolCall providers.ToolCall) string
}

type FlowTool interface {
	Report(toolCall providers.ToolCall) string
	Wait(toolCall providers.ToolCall) string
}
