package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

type WorkerResponseNotification struct {
	AgentID  string `json:"agent_id"`
	Response string `json:"response"`
}

type WorkerMessage struct {
	FromAgentID string      `json:"from_agent_id"`
	ToAgentID   string      `json:"to_agent_id"`
	MessageType string      `json:"message_type"`
	Payload     interface{} `json:"payload"`
}

func GetAgentResponseTopic(agentID string) string {
	return fmt.Sprintf("%s_response", agentID)
}

func GetAgentResponseGeneralTopic() string {
	return "agent_response"
}

func GetAgentMessageTopic() string {
	return "agent_message"
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

func (w *WorkerImpl) sendMessage(toAgentID string, messageType string, payload interface{}) error {
	message := WorkerMessage{
		FromAgentID: *w.ID,
		ToAgentID:   toAgentID,
		MessageType: messageType,
		Payload:     payload,
	}
	messageBytes, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return w.pubSub.Publish(context.Background(), GetAgentMessageTopic(), string(messageBytes), 5*time.Second)
}

func (w *WorkerImpl) startMessageListener() error {
	callback := func(message string) error {
		var agentMessage WorkerMessage
		if err := json.Unmarshal([]byte(message), &agentMessage); err != nil {
			return err
		}
		if agentMessage.ToAgentID != *w.ID {
			// Not intended for this agent
			return nil
		}
		// Process the message based on messageType
		switch agentMessage.MessageType {
		case "call":
			// Handle incoming call
		case "answer":
			// Handle answer
			// Other message types...
		}
		return nil
	}
	err := w.pubSub.Subscribe(GetAgentMessageTopic(), callback)
	if err != nil {
		slog.Error("Worker: Failed to subscribe to agent-messages", "error", err)
		return err
	}
	return nil
}
