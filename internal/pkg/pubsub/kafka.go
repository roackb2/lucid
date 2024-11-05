package pubsub

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/roackb2/lucid/config"
	"github.com/segmentio/kafka-go"
)

const (
	DefaultPartition      = 0
	DefaultReaderMaxBytes = 10 * 1024 * 1024 // 10MB
)

type KafkaPubSub struct {
	writer             *kafka.Writer
	subscriptions      map[string]context.CancelFunc
	subscriptionsMutex sync.Mutex
}

func NewKafkaPubSub() *KafkaPubSub {
	return &KafkaPubSub{
		writer: &kafka.Writer{
			Addr:                   kafka.TCP(config.Config.Kafka.Address),
			Balancer:               &kafka.LeastBytes{},
			AllowAutoTopicCreation: true,
			MaxAttempts:            5, // Increase the number of attempts
			ReadTimeout:            10 * time.Second,
			WriteTimeout:           10 * time.Second,
			RequiredAcks:           kafka.RequireAll,
		},
		subscriptions: make(map[string]context.CancelFunc),
	}
}

func (k *KafkaPubSub) Publish(ctx context.Context, topic string, message string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	maxRetries := 3
	retryDelay := 500 * time.Millisecond

	var err error
	for i := 0; i < maxRetries; i++ {
		err = k.writer.WriteMessages(ctx, kafka.Message{
			Topic: topic,
			Value: []byte(message),
		})
		if err != nil {
			if isUnknownTopicOrPartitionError(err) {
				// Wait and retry
				time.Sleep(retryDelay)
				continue
			}
			slog.Error("KafkaPubSub: failed to write message", "error", err)
			return err
		}
		// Success
		return nil
	}
	// Return the last error
	return err
}

func isUnknownTopicOrPartitionError(err error) bool {
	// Check if the error matches the "Unknown Topic Or Partition" error
	if kafkaErr, ok := err.(kafka.Error); ok {
		return kafkaErr.Temporary() && (strings.Contains(kafkaErr.Error(), "Unknown Topic Or Partition") ||
			strings.Contains(kafkaErr.Error(), "Leader Not Available"))
	}
	return false
}

func (k *KafkaPubSub) Subscribe(topic string, callback OnMessageCallback) error {
	ctx, cancel := context.WithCancel(context.Background())

	k.subscriptionsMutex.Lock()
	k.subscriptions[topic] = cancel
	k.subscriptionsMutex.Unlock()

	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  []string{config.Config.Kafka.Address},
		Topic:    topic,
		MaxBytes: DefaultReaderMaxBytes,
	})
	r.SetOffset(kafka.LastOffset)

	go func() {
		defer r.Close()
		for {
			m, err := r.ReadMessage(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					slog.Info("KafkaPubSub: subscription to topic canceled", "topic", topic)
					return
				}
				slog.Error("KafkaPubSub: failed to read message", "error", err)
				return
			}
			if err := callback(string(m.Value)); err != nil {
				slog.Error("KafkaPubSub: callback error", "error", err)
			}
		}
	}()
	return nil
}

func (k *KafkaPubSub) Unsubscribe(topic string) {
	k.subscriptionsMutex.Lock()
	if cancel, ok := k.subscriptions[topic]; ok {
		cancel()
		delete(k.subscriptions, topic)
	}
	k.subscriptionsMutex.Unlock()
}

func (k *KafkaPubSub) Close() error {
	k.subscriptionsMutex.Lock()
	for _, cancel := range k.subscriptions {
		cancel()
	}
	k.subscriptions = make(map[string]context.CancelFunc)
	k.subscriptionsMutex.Unlock()

	return k.writer.Close()
}
