package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/roackb2/lucid/internal/pkg/pubsub"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	kafkaPubSub := pubsub.NewKafkaPubSub()
	defer kafkaPubSub.Close()

	topic := fmt.Sprintf("%s_response", uuid.New().String())

	go func() {
		messageCallback := func(message string) error {
			slog.Info("KafkaPubSub: received message", "message", message)
			return nil
		}
		err := kafkaPubSub.Subscribe(topic, messageCallback)
		if err != nil {
			slog.Error("KafkaPubSub: failed to subscribe", "error", err)
		}
	}()

	publishTimeout := 10 * time.Second

	slog.Info("KafkaPubSub: publishing message")
	err := kafkaPubSub.Publish(ctx, topic, "hello", publishTimeout)
	if err != nil {
		slog.Error("KafkaPubSub: failed to publish", "error", err)
	}
	slog.Info("KafkaPubSub: message published")

	time.Sleep(1 * time.Second)

	slog.Info("KafkaPubSub: publishing message")
	err = kafkaPubSub.Publish(ctx, topic, "world", publishTimeout)
	if err != nil {
		slog.Error("KafkaPubSub: failed to publish", "error", err)
	}
	slog.Info("KafkaPubSub: message published")

	time.Sleep(1 * time.Second)

	slog.Info("KafkaPubSub: done")
}
