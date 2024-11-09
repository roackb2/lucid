package ws

import "github.com/roackb2/lucid/internal/pkg/agents/worker"

type WsEventType string

const (
	WsEventTypePing          WsEventType = "ping"
	WsEventTypePong          WsEventType = "pong"
	WsEventTypeAgentResponse WsEventType = "agent_response"
	WsEventTypeAgentProgress WsEventType = "agent_progress"
)

// NOTE: This is a temporary solution to provide all worker notification types to the swagger doc.
// We need to find a better way to handle this in the future.
// @Description All websocket response data types
type WebSocketDataTypes struct {
	Response *worker.WorkerResponseNotification `json:"response,omitempty"`
	Progress *worker.WorkerProgressNotification `json:"progress,omitempty"`
	Message  *worker.WorkerMessage              `json:"message,omitempty"`
	Pong     string                             `json:"pong,omitempty"`
}

// @Description: A message sent over the websocket connection.
type WsMessage struct {
	Event WsEventType        `json:"event"`
	Data  WebSocketDataTypes `json:"data"`
}

type WsConnection interface {
	ReadMessage() (int, []byte, error)
	ReadJSON(v interface{}) error
	WriteMessage(mt int, message []byte) error
	WriteJSON(message interface{}) error
	Close() error
}

type WsHandler interface {
	HandleConnection() error
}
