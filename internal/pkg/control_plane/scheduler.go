package control_plane

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
)

const (
	ScanInterval       = 1 * time.Second
	AgentSleepDuration = 10 * time.Second
)

type Scheduler struct {
	controlCh chan string
}

func NewScheduler(ctx context.Context) *Scheduler {
	return &Scheduler{
		controlCh: make(chan string),
	}
}

func (s *Scheduler) SendCommand(ctx context.Context, cmd string) error {
	if s.controlCh == nil {
		slog.Error("Scheduler: Control channel not initialized")
		return nil
	}
	select {
	case s.controlCh <- cmd:
		slog.Info("Scheduler: Sent command", "command", cmd)
		return nil
	case <-ctx.Done():
		return fmt.Errorf("context canceled, cannot send command")
	case <-time.After(1 * time.Second):
		return fmt.Errorf("sending command timed out")
	}
}

func (s *Scheduler) Start(ctx context.Context) error {
	slog.Info("Scheduler started")
	ticker := time.NewTicker(ScanInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("Scheduler context done")
			return ctx.Err()
		case cmd, ok := <-s.controlCh:
			if !ok {
				slog.Error("Scheduler control channel closed")
				return fmt.Errorf("control channel closed")
			}
			slog.Info("Scheduler received command", "command", cmd)
			switch cmd {
			case "stop":
				slog.Info("Scheduler stopping")
				return nil
			default:
				slog.Warn("Scheduler received unknown command", "command", cmd)
			}
		case <-ticker.C:
			slog.Info("Scheduler searching for agents")
			err := s.searchAgents(ctx)
			if err != nil {
				slog.Error("Scheduler failed to search agents", "error", err)
				return err
			}
		}
	}
}

func (s *Scheduler) searchAgents(ctx context.Context) error {
	// TODO: Change status to asleep
	agents, err := dbaccess.Querier.SearchAgentByStatus(ctx, worker.StatusAsleep)
	if err != nil {
		slog.Error("Scheduler failed to search agents", "error", err)
		return err
	}

	slog.Info("Scheduler found agents", "num_agents", len(agents))
	for _, agent := range agents {
		if time.Now().After(agent.AsleepAt.Time.Add(AgentSleepDuration)) {
			// dbaccess.Querier.UpdateAgentState(ctx, dbaccess.UpdateAgentStateParams{
			// 	AgentID: agent.AgentID,
			// 	Status:  worker.StatusRunning,
			// })
			slog.Info("Scheduler handling asleep agent, waking up", "agent_id", agent.AgentID)
			// TODO: Register to agent controller
		}
	}

	return nil
}
