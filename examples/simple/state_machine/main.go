package main

import (
	"context"
	"fmt"
	"time"

	"github.com/looplab/fsm"
)

var (
	counter = 0
)

func main() {
	controlCh := make(chan string, 1)
	reportCh := make(chan string, 1)

	go func() {
		response := StartTask(controlCh, reportCh)
		fmt.Println("Response:", response)
	}()

	time.Sleep(1 * time.Second)

	controlCh <- "pause"
	fmt.Println("Sent pause command")
	status := <-reportCh
	fmt.Println("Received:", status)

	time.Sleep(1 * time.Second)

	controlCh <- "resume"
	fmt.Println("Sent resume command")
	status = <-reportCh
	fmt.Println("Received:", status)

	time.Sleep(1 * time.Second)

	controlCh <- "terminate"
	fmt.Println("Sent terminate command")
	status = <-reportCh
	fmt.Println("Received:", status)

	fmt.Println("Done")
}

func StartTask(controlCh <-chan string, reportCh chan<- string) string {
	response := ""

	taskFSM := fsm.NewFSM(
		"running",
		fsm.Events{
			{Name: "pause", Src: []string{"running"}, Dst: "paused"},
			{Name: "resume", Src: []string{"paused"}, Dst: "running"},
			{Name: "terminate", Src: []string{"running", "paused"}, Dst: "terminated"},
		},
		fsm.Callbacks{
			"enter_state": func(_ context.Context, e *fsm.Event) {
				fmt.Printf("Transitioned to state: %s\n", e.Dst)
			},
			"after_pause": func(_ context.Context, e *fsm.Event) {
				reportCh <- "paused"
			},
			"after_resume": func(_ context.Context, e *fsm.Event) {
				reportCh <- "resumed"
			},
			"after_terminate": func(_ context.Context, e *fsm.Event) {
				CleanUp()
				reportCh <- "terminated"
			},
		},
	)

	for response == "" && taskFSM.Current() != "terminated" {
		select {
		case cmd := <-controlCh:
			err := taskFSM.Event(context.Background(), cmd)
			if err != nil {
				fmt.Println("Error processing event:", err)
			}
		default:
			if taskFSM.Current() == "running" {
				response = GetResponse()
			} else {
				// When paused, sleep briefly to prevent tight loop
				time.Sleep(100 * time.Millisecond)
			}
		}
	}

	return response
}

func CleanUp() {
	fmt.Println("Cleaning up")
}

func GetResponse() string {
	// Simulate that agents would require a few iterations to get a response
	counter++
	time.Sleep(2 * time.Second)
	if counter < 3 {
		return ""
	}
	return fmt.Sprintf("Response %d", counter)
}
