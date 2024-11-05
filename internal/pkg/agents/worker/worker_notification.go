package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
)

type WorkerResponseNotification struct {
	AgentID  string `json:"agent_id"`
	Response string `json:"response"`
}

func GetAgentResponseTopic(agentID string) string {
	return fmt.Sprintf("%s_response", agentID)
}

func GetAgentResponseGeneralTopic() string {
	return "agent_response"
}

func (w *WorkerImpl) publishFinalResponse(ctx context.Context, response string) error {
	slog.Info("Worker: Publishing final response", "agentID", *w.ID, "response", response)
	payload := WorkerResponseNotification{
		AgentID:  *w.ID,
		Response: response,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		slog.Error("Worker: Failed to marshal payload", "error", err)
		return err
	}
	topic := GetAgentResponseTopic(*w.ID)
	err = w.pubSub.Publish(ctx, topic, string(payloadBytes), PublishTimeout)
	if err != nil {
		slog.Error("Worker: Failed to publish response", "error", err)
		return err
	}
	generalTopic := GetAgentResponseGeneralTopic()
	err = w.pubSub.Publish(ctx, generalTopic, string(payloadBytes), PublishTimeout)
	if err != nil {
		slog.Error("Worker: Failed to publish response", "error", err)
		return err
	}
	return nil
}
