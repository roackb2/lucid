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
	// @Description: A worker response notification.
	Response *worker.WorkerResponseNotification `json:"response,omitempty"`
	// @Description: A worker progress notification.
	Progress *worker.WorkerProgressNotification `json:"progress,omitempty"`
	// @Description: A pong message that just echo back.
	Pong string `json:"pong,omitempty"`
}

// @Description: A message sent over the websocket connection.
type WsMessage struct {
	// @Description: The event type of the message.
	Event WsEventType `json:"event"`
	// @Description: The data of the message. Each field is optional, depending on the event type.
	Data WebSocketDataTypes `json:"data"`
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
