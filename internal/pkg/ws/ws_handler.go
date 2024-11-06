package ws

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
)

type WsHandlerImpl struct {
	conn WsConnection
}

func NewWsHandler(conn WsConnection) *WsHandlerImpl {
	return &WsHandlerImpl{conn: conn}
}

func (h *WsHandlerImpl) HandleConnection(ctx context.Context) error {
	var wg sync.WaitGroup
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	for {
		select {
		case <-ctx.Done():
			wg.Wait()
			return ctx.Err()
		default:
			var msg WsMessage
			err := h.conn.ReadJSON(&msg)
			if err != nil {
				slog.Error("read:", "error", err)
				wg.Wait()
				return err
			}
			slog.Info("Received message", "event", msg.Event)

			wg.Add(1)
			go func(msg WsMessage) {
				defer wg.Done()
				err := h.handleMessage(msg)
				if err != nil {
					slog.Error("handleMessage:", "error", err)
				}
			}(msg)
		}
	}
}

func (w *WsHandlerImpl) handleMessage(msg WsMessage) error {
	switch msg.Event {
	case WsEventTypePing:
		return w.handlePing(msg)
	default:
		return fmt.Errorf("unknown event: %s", msg.Event)
	}
}

func (w *WsHandlerImpl) handlePing(msg WsMessage) error {
	slog.Info("Received ping message")

	respMsg := WsMessage{
		Event: WsEventTypePong,
		Data:  fmt.Sprintf("pong: %s", msg.Data),
	}

	w.conn.WriteJSON(respMsg)
	return nil
}
