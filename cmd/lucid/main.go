package main

import (
	"fmt"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
)

func main() {
	storage := storage.NewRelationalStorage()
	publisher := agents.NewPublisher("I have a new song called 'Jazz in the Rain'. Please publish it.", storage)
	consumer := agents.NewConsumer("Is there any new Jazz music?", storage)
	resCh := make(chan string)
	errCh := make(chan error)
	go publisher.StartTask(resCh, errCh)
	go consumer.StartTask(resCh, errCh)

	// Next step: collect published content and persists to storage
	// Allow agent to search for content
	for {
		select {
		case msg := <-resCh:
			fmt.Println(msg)
		case err := <-errCh:
			fmt.Println(err)
		}
	}
}
