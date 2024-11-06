package controllers

import (
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type WebsocketController struct {
	upgrader websocket.Upgrader
}

func NewWebsocketController() *WebsocketController {
	return &WebsocketController{upgrader: websocket.Upgrader{}}
}

func (ac *WebsocketController) SocketHandler(c *gin.Context) {
	conn, err := ac.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		slog.Error("upgrade:", "error", err)
		return
	}
	defer conn.Close()

	for {
		mt, message, err := conn.ReadMessage()
		if err != nil {
			slog.Error("read:", "error", err)
			break
		}

		err = conn.WriteMessage(mt, message)
		if err != nil {
			slog.Error("write:", "error", err)
			break
		}
	}
}
