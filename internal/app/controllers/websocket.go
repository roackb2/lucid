package controllers

import (
	"context"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
	"github.com/roackb2/lucid/internal/pkg/ws"
)

// WebsocketController is a controller for websocket connections
// Though the connection handling is delegated to the ws package,
// this controller is to abstract from the actual implementation of the gorilla/websocket package
// and to provide a clean interface for the websocket connections.
type WebsocketController struct {
	ctx      context.Context
	upgrader websocket.Upgrader
	pubsub   pubsub.PubSub
}

func NewWebsocketController(ctx context.Context, pubsub pubsub.PubSub) *WebsocketController {
	return &WebsocketController{ctx: ctx, upgrader: websocket.Upgrader{}, pubsub: pubsub}
}

func (ac *WebsocketController) SocketHandler(c *gin.Context) {
	slog.Info("Websocket connection established")
	conn, err := ac.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		slog.Error("upgrade:", "error", err)
		return
	}
	defer conn.Close()

	handler := ws.NewWsHandler(conn, ac.pubsub)
	handler.HandleConnection(ac.ctx)
}
