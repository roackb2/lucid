// Package pubsub provides an interface for a publish-subscribe messaging system.
//
// The PubSub interface defines methods for publishing messages to topics,
// subscribing to topics with callback functions, unsubscribing from topics,
// and closing the PubSub system gracefully. Implementations of this interface
// can integrate with various messaging platforms like Kafka, RabbitMQ, etc.
package pubsub

import (
	"context"
	"time"
)

// OnMessageCallback is a function type that defines the signature for
// callback functions used in subscriptions.
//
// The callback function receives a context and the message as a string.
// It returns an error if processing the message fails.
//
// The context can be used to manage cancellation and deadlines for the
// callback execution.
type OnMessageCallback func(ctx context.Context, message string) error

// PubSub defines the interface for a publish-subscribe messaging system.
//
// Implementations of this interface should provide mechanisms to publish messages
// to topics, subscribe to topics with callbacks, unsubscribe from topics,
// and close the PubSub system gracefully.
type PubSub interface {
	// Publish sends a message to the specified topic.
	//
	// Parameters:
	// - ctx: The context for controlling cancellation and deadlines.
	// - topic: The topic to which the message will be published.
	// - message: The message content to be published.
	// - timeout: The maximum duration to wait for the publish operation to complete.
	//
	// Returns:
	// - error: An error if the publish operation fails; otherwise, nil.
	Publish(ctx context.Context, topic string, message string, timeout time.Duration) error

	// Subscribe registers a callback function to receive messages from the specified topic.
	//
	// Parameters:
	// - ctx: The context for controlling cancellation and deadlines.
	// - topic: The topic to subscribe to.
	// - callback: The function to be called when a message is received.
	//
	// Returns:
	// - error: An error if the subscription fails; otherwise, nil.
	//
	// The subscription will remain active until the context is canceled.
	Subscribe(ctx context.Context, topic string, callback OnMessageCallback) error

	// Unsubscribe removes the subscription from the specified topic.
	//
	// Parameters:
	// - topic: The topic to unsubscribe from.
	//
	// If there is no active subscription to the topic, this method has no effect.
	Unsubscribe(topic string)

	// Close gracefully shuts down the PubSub system, releasing any allocated resources.
	//
	// Returns:
	// - error: An error if the shutdown process fails; otherwise, nil.
	//
	// After calling Close, the PubSub instance should not be used.
	Close() error
}
