package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"

	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
)

type WsHandlerImpl struct {
	conn   WsConnection
	pubsub pubsub.PubSub
}

func NewWsHandler(conn WsConnection, pubsub pubsub.PubSub) *WsHandlerImpl {
	return &WsHandlerImpl{conn: conn, pubsub: pubsub}
}

func (h *WsHandlerImpl) HandleConnection(ctx context.Context) error {
	var wg sync.WaitGroup
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	err := h.subscribeToEvents()
	if err != nil {
		slog.Error("subscribeToEvents:", "error", err)
		return err
	}

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

func (w *WsHandlerImpl) subscribeToEvents() error {
	err := w.pubsub.Subscribe(worker.GetAgentResponseGeneralTopic(), w.handleAgentResponse)
	if err != nil {
		return err
	}
	return nil
}

func (w *WsHandlerImpl) handleAgentResponse(message string) error {
	slog.Info("Received agent response", "message", message)
	notification := worker.WorkerResponseNotification{}
	err := json.Unmarshal([]byte(message), &notification)
	if err != nil {
		return err
	}
	// TODO: Filter messages with client specified agent id
	w.conn.WriteJSON(WsMessage{
		Event: WsEventTypeAgentResponse,
		Data:  notification.Response,
	})
	return nil
}
