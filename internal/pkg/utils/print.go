package utils

import (
	"encoding/json"
	"fmt"
)

func PrintStruct(data interface{}) {
	dataJson, _ := json.MarshalIndent(data, "", "  ")
	fmt.Printf("%s\n", dataJson)
}
