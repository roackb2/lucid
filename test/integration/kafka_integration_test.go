package pubsub_integration_test

import (
	"context"
	"testing"
	"time"

	"github.com/roackb2/lucid/internal/pkg/pubsub"
	"github.com/stretchr/testify/require"
)

func TestKafkaPubSub_Integration(t *testing.T) {
	pubsub := pubsub.NewKafkaPubSub()
	defer pubsub.Close()

	topic := "test-topic"
	message := "test-message"

	ctx := context.Background()

	// Start a subscriber
	receivedMessages := make(chan string)
	err := pubsub.Subscribe(topic, func(msg string) error {
		receivedMessages <- msg
		return nil
	})
	require.NoError(t, err)
	defer pubsub.Unsubscribe(topic)

	// Publish a message
	err = pubsub.Publish(ctx, topic, message, 5*time.Second)
	require.NoError(t, err)

	// Wait for the message to be received
	select {
	case msg := <-receivedMessages:
		require.Equal(t, message, msg)
	case <-time.After(5 * time.Second):
		require.Fail(t, "Did not receive message in time")
	}
}
