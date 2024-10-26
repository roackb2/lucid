package utils

import (
	"encoding/json"
	"fmt"
	"time"
)

func PrintStruct(data interface{}) {
	dataJson, _ := json.MarshalIndent(data, "", "  ")
	fmt.Printf("%s\n", dataJson)
}

func GetOrDefault[T int | time.Duration](value, defaultValue T) T {
	if value == 0 {
		return defaultValue
	}
	return value
}
