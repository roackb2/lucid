package main

import (
	"fmt"

	"github.com/roackb2/lucid/internal/pkg/foundation_models"
)

func main() {
	response, err := foundation_models.Chat("Say this is a test")
	if err != nil {
		panic(err.Error())
	}
	fmt.Println(response)
}
