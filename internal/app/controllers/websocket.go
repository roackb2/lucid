package controllers

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/roackb2/lucid/internal/pkg/ws"
)

type WebsocketController struct {
	ctx      context.Context
	upgrader websocket.Upgrader
}

func NewWebsocketController(ctx context.Context) *WebsocketController {
	return &WebsocketController{ctx: ctx, upgrader: websocket.Upgrader{}}
}

func (ac *WebsocketController) SocketHandler(c *gin.Context) {
	slog.Info("Websocket connection established")
	conn, err := ac.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		slog.Error("upgrade:", "error", err)
		return
	}
	defer conn.Close()

	handler := ws.NewWsHandler(conn)
	handler.HandleConnection(ac.ctx)
}
