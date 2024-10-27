package utils

import (
	"fmt"
	"runtime/debug"
)

func RecoverPanic() {
	r := recover()
	if r != nil {
		fmt.Printf("Recovered from panic: %+v\n%s", r, string(debug.Stack()))
	}
}
