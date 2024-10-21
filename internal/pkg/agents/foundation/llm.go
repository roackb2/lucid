package foundation

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/tools"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

const (
	SleepInterval = 1 * time.Second
)

type FoundationModel interface {
	Chat(prompt string) (string, error)
}

type LLM struct {
	role    string
	client  *openai.Client
	storage storage.Storage
}

func NewFoundationModel(role string, storage storage.Storage) FoundationModel {
	client := openai.NewClient(
		option.WithAPIKey(config.Config.OpenAI.APIKey),
	)
	return &LLM{
		role:    role,
		client:  client,
		storage: storage,
	}
}

func (l *LLM) Chat(prompt string) (string, error) {
	ctx := context.Background()

	persistTool := tools.NewPersistTool(l.storage)
	flowTool := tools.NewFlowTool()
	tools := append(persistTool.GetToolDefinition(), flowTool.GetToolDefinition()...)

	params := openai.ChatCompletionNewParams{
		Messages: openai.F([]openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(SystemPrompt),
			openai.UserMessage(prompt),
		}),
		Tools: openai.F(tools),
		Model: openai.F(openai.ChatModelGPT4o),
	}

	for true {
		l.debugStruct("Agent chat messages", params.Messages.Value)

		// Ask the LLM
		chatCompletion, err := l.client.Chat.Completions.New(ctx, params)
		if err != nil {
			slog.Error("Agent chat error", "role", l.role, "error", err)
			return "", err
		}
		agentResponse := chatCompletion.Choices[0].Message
		params.Messages.Value = append(params.Messages.Value, agentResponse)

		l.debugStruct("Agent chat completion", chatCompletion)

		// Handle tool calls
		for _, toolCall := range agentResponse.ToolCalls {
			funcName := toolCall.Function.Name
			slog.Info("Agent tool call", "role", l.role, "tool_call", funcName)

			toolMsgContent := ""
			switch funcName {
			case "save_content":
				err = persistTool.SaveContent(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", l.role, "tool_call", funcName, "error", err)
					toolMsgContent = fmt.Sprintf("Error: %v", err)
				} else {
					toolMsgContent = "Content saved successfully."
				}
			case "search_content":
				toolRes, err := persistTool.SearchContent(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", l.role, "tool_call", funcName, "error", err)
					toolMsgContent = fmt.Sprintf("Error: %v", err)
				} else {
					toolMsgContent = fmt.Sprintf("Results: %v", strings.Join(toolRes, ", "))
				}
			case "report":
				slog.Info("Agent report tool call", "role", l.role, "tool_call", funcName)
				toolMsgContent, err := flowTool.Report(ctx, toolCall)
				if err != nil {
					slog.Error("Agent tool call error", "role", l.role, "tool_call", funcName, "error", err)
					toolMsgContent = fmt.Sprintf("Error: %v", err)
				}
				return toolMsgContent, nil
			}
			slog.Info("Agent tool message", "role", l.role, "message", toolMsgContent)
			params.Messages.Value = append(params.Messages.Value, openai.ToolMessage(toolCall.ID, toolMsgContent))
		}
	}

	time.Sleep(SleepInterval)

	return "", nil
}

func (l *LLM) debugStruct(title string, v any) {
	slog.Info(title, "role", l.role)
	utils.PrintStruct(v)
}
