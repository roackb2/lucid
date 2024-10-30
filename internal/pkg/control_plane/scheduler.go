package control_plane

import (
	"context"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents/foundation"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
)

const (
	ScanInterval       = 1 * time.Second
	AgentSleepDuration = 10 * time.Second
)

type Scheduler struct {
}

func NewScheduler(ctx context.Context) *Scheduler {
	return &Scheduler{}
}

func (s *Scheduler) Start(ctx context.Context, controlCh chan string, reportCh chan string, errCh chan error) {
	slog.Info("Scheduler started")
	ticker := time.NewTicker(ScanInterval)
	go func(ticker *time.Ticker) {
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				slog.Info("Scheduler searching for agents")
				// TODO: Kick off as goroutine
				err := s.searchAgents(ctx)
				if err != nil {
					slog.Error("Scheduler failed to search agents", "error", err)
					errCh <- err
				}
			case cmd := <-controlCh:
				slog.Info("Scheduler received command", "command", cmd)
				if cmd == "stop" {
					slog.Info("Scheduler stopping")
					reportCh <- "stop"
					return
				}
			case <-ctx.Done():
				slog.Info("Scheduler context done")
				return
			}
		}
	}(ticker)
}

func (s *Scheduler) searchAgents(ctx context.Context) error {
	// TODO: Change status to asleep
	agents, err := dbaccess.Querier.SearchAgentByStatus(ctx, foundation.StatusTerminated)
	if err != nil {
		slog.Error("Scheduler failed to search agents", "error", err)
		return err
	}

	slog.Info("Scheduler found agents", "num_agents", len(agents))
	for _, agent := range agents {
		if time.Now().After(agent.AsleepAt.Time.Add(AgentSleepDuration)) {
			// dbaccess.Querier.UpdateAgentState(ctx, dbaccess.UpdateAgentStateParams{
			// 	AgentID: agent.AgentID,
			// 	Status:  foundation.StatusRunning,
			// })
			slog.Info("Scheduler handling asleep agent, waking up", "agent_id", agent.AgentID)
			// TODO: Register to agent controller
		}
	}

	return nil
}
