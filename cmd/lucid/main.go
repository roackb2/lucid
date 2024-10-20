package main

import (
	"fmt"

	"github.com/roackb2/lucid/internal/pkg/agents"
)

func main() {
	publisher := agents.NewPublisher("I have a new song called 'Jazz in the Rain'.")
	consumer := agents.NewConsumer("Is there any new Jazz music?")
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
