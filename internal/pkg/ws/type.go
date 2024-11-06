package ws

type WsEventType string

const (
	WsEventTypePing WsEventType = "ping"
	WsEventTypePong WsEventType = "pong"
)

type WsMessage struct {
	Event WsEventType `json:"event"`
	Data  any         `json:"data"`
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
