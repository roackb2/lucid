// Package worker contains the worker agent implementation and related notifications.
//
// swagger:meta
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// WorkerResponseNotification represents a response notification from a worker agent.
// @Description Response notification containing the agent ID and response message
type WorkerResponseNotification struct {
	// The ID of the agent sending the response
	// @Description Unique identifier of the agent
	AgentID string `json:"agent_id" swaggertype:"string"`
	// The response message content
	// @Description Response message from the agent
	Response string `json:"response" swaggertype:"string"`
}

// WorkerProgressNotification represents a progress update from a worker agent.
// @Description Progress notification containing the agent ID and progress message
type WorkerProgressNotification struct {
	// The ID of the agent reporting progress
	AgentID string `json:"agent_id" swaggertype:"string"`
	// The progress message content
	Progress string `json:"progress" swaggertype:"string"`
}

// WorkerMessage represents a message between worker agents.
// @Description Message structure for inter-agent communication
type WorkerMessage struct {
	// The ID of the sending agent
	FromAgentID string `json:"from_agent_id" swaggertype:"string"`
	// The ID of the receiving agent
	ToAgentID string `json:"to_agent_id" swaggertype:"string"`
	// The type of message being sent
	MessageType string `json:"message_type" swaggertype:"string"`
	// The message payload
	Payload interface{} `json:"payload" swaggertype:"object"`
}

func GetAgentResponseTopic(agentID string) string {
	return fmt.Sprintf("%s_response", agentID)
}

// GetAgentResponseGeneralTopic returns the general topic for agent responses
func GetAgentResponseGeneralTopic() string {
	return "agent_response"
}

// GetAgentProgressTopic returns the topic for agent progress
func GetAgentProgressTopic() string {
	return "agent_progress"
}

// GetAgentMessageTopic returns the topic for agent messages between agents
func GetAgentMessageTopic() string {
	return "agent_message"
}

// publishFinalResponse publishes the final response to the agent and the general topic
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

func (w *WorkerImpl) publishProgress(ctx context.Context, progress string) error {
	slog.Info("Worker: Publishing progress", "agentID", *w.ID, "progress", progress)
	payload := WorkerProgressNotification{
		AgentID:  *w.ID,
		Progress: progress,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		slog.Error("Worker: Failed to marshal payload", "error", err)
		return err
	}
	return w.pubSub.Publish(ctx, GetAgentProgressTopic(), string(payloadBytes), PublishTimeout)
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
