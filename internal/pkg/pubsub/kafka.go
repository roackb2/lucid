package pubsub

import (
	"context"
	"log/slog"
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
		},
		subscriptions: make(map[string]context.CancelFunc),
	}
}

func (k *KafkaPubSub) Publish(ctx context.Context, topic string, message string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	err := k.writer.WriteMessages(ctx, kafka.Message{
		Topic: topic,
		Value: []byte(message),
	})
	if err != nil {
		slog.Error("KafkaPubSub: failed to write message", "error", err)
		return err
	}
	return nil
}

func (k *KafkaPubSub) Subscribe(topic string, callback OnMessageCallback) error {
	ctx, cancel := context.WithCancel(context.Background())

	k.subscriptionsMutex.Lock()
	k.subscriptions[topic] = cancel
	k.subscriptionsMutex.Unlock()

	go func() {
		r := kafka.NewReader(kafka.ReaderConfig{
			Brokers:  []string{config.Config.Kafka.Address},
			Topic:    topic,
			MaxBytes: DefaultReaderMaxBytes,
		})
		r.SetOffset(kafka.LastOffset)
		defer r.Close()

		for {
			m, err := r.ReadMessage(ctx)
			if err != nil {
				if err == context.Canceled {
					slog.Info("KafkaPubSub: subscription to topic canceled", "topic", topic)
					return
				}
				slog.Error("KafkaPubSub: failed to read message", "error", err)
				return
			}
			if err := callback(ctx, string(m.Value)); err != nil {
				slog.Error("KafkaPubSub: callback error", "error", err)
				return
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
