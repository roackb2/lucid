package main

import (
	"fmt"
	"time"
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
	for response == "" {
		select {
		case cmd := <-controlCh:
			switch cmd {
			case "terminate":
				CleanUp()
				reportCh <- "terminated"
				return response
			case "pause":
				reportCh <- "paused"
				for {
					select {
					case cmd := <-controlCh:
						switch cmd {
						case "resume":
							reportCh <- "resumed"
							break
						case "terminate":
							CleanUp()
							reportCh <- "terminated"
							return response
						default:
							fmt.Println("Unknown command during pause:", cmd)
						}
					}
				}
			default:
				fmt.Println("Unknown command:", cmd)
			}
		default:
			response = GetResponse()
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
