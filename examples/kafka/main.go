package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/internal/pkg/pubsub"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	kafkaPubSub := pubsub.NewKafkaPubSub()
	defer kafkaPubSub.Close()

	messageCallback := func(ctx context.Context, message string) error {
		slog.Info("KafkaPubSub: received message", "message", message)
		return nil
	}
	if err := kafkaPubSub.Subscribe("example-topic", messageCallback); err != nil {
		slog.Error("KafkaPubSub: failed to subscribe", "error", err)
	}

	slog.Info("KafkaPubSub: publishing message")
	kafkaPubSub.Publish(ctx, "example-topic", "hello", 3*time.Second)
	slog.Info("KafkaPubSub: message published")

	time.Sleep(1 * time.Second)

	slog.Info("KafkaPubSub: publishing message")
	kafkaPubSub.Publish(ctx, "example-topic", "world", 3*time.Second)
	slog.Info("KafkaPubSub: message published")

	time.Sleep(1 * time.Second)

	slog.Info("KafkaPubSub: done")
}
