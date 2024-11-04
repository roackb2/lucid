package pubsub_integration_test

import (
	"context"
	"testing"
	"time"

	"github.com/roackb2/lucid/internal/pkg/pubsub"
)

func TestKafkaPubSub_Integration(t *testing.T) {
	pubsub := pubsub.NewKafkaPubSub()
	defer pubsub.Close()

	topic := "test-topic"
	message := "test-message"

	ctx := context.Background()

	// Start a subscriber
	receivedMessages := make(chan string)
	errCh := make(chan error)
	go func() {
		err := pubsub.Subscribe(topic, func(msg string) error {
			receivedMessages <- msg
			return nil
		})
		errCh <- err
	}()
	defer pubsub.Unsubscribe(topic)

	// Publish a message
	err := pubsub.Publish(ctx, topic, message, 5*time.Second)
	if err != nil {
		t.Fatalf("Publish returned error: %v", err)
	}

	// Wait for the message to be received
	select {
	case msg := <-receivedMessages:
		if msg != message {
			t.Fatalf("Expected message %q, got %q", message, msg)
		}
	case err := <-errCh:
		t.Fatalf("Subscribe returned error: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("Did not receive message in time")
	}
}
