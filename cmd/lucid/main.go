package main

import (
	"fmt"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

func main() {
	storage := storage.NewMemoryStorage()
	publisher := agents.NewPublisher("I have a new song called 'Jazz in the Rain'.", storage)
	consumer := agents.NewConsumer("Is there any new Jazz music?", storage)
	ch := make(chan string)
	go publisher.StartTask(ch)
	go consumer.StartTask(ch)

	// Next step: collect published content and persists to storage
	// Allow agent to search for content
	for {
		select {
		case msg := <-ch:
			fmt.Println(msg)
		}
	}
}
