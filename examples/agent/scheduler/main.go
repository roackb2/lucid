package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/control_plane"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

func main() {
	defer utils.RecoverPanic()

	if err := config.LoadConfig("dev"); err != nil {
		slog.Error("Error loading configuration:", "error", err)
		panic(err)
	}

	err := dbaccess.Initialize()
	if err != nil {
		slog.Error("RelationalStorage: Failed to initialize querier", "error", err)
		panic(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	doneCh := make(chan struct{})

	scheduler := control_plane.NewScheduler(ctx)
	go func() {
		err := scheduler.Start(ctx)
		if err != nil {
			slog.Error("Scheduler failed", "error", err)
			panic(err)
		}
		doneCh <- struct{}{}
	}()

	time.Sleep(5 * time.Second)
	err = scheduler.SendCommand(ctx, "stop")
	if err != nil {
		slog.Error("Scheduler failed to send command", "error", err)
		panic(err)
	}

	<-doneCh
}
