package control_plane

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
	"github.com/roackb2/lucid/internal/pkg/utils"
)

const (
	SchedulerControlChSize = 10
	ScanInterval           = 1 * time.Second
	AgentSleepDuration     = 10 * time.Second
	AgentAwakeDuration     = 5 * time.Minute
	BatchProcessAgentNum   = 10
)

type SchedulerImpl struct {
	controlCh    chan string
	onAgentFound OnAgentFoundCallback
}

func NewScheduler(ctx context.Context, onAgentFound OnAgentFoundCallback) *SchedulerImpl {
	return &SchedulerImpl{
		controlCh:    make(chan string, SchedulerControlChSize),
		onAgentFound: onAgentFound,
	}
}

func (s *SchedulerImpl) SetCallback(callback OnAgentFoundCallback) {
	if s.onAgentFound != nil {
		slog.Warn("Scheduler: Overriding existing callback")
	}
	s.onAgentFound = callback
}

func (s *SchedulerImpl) SendCommand(ctx context.Context, cmd string) error {
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

func (s *SchedulerImpl) Start(ctx context.Context) error {
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

func (s *SchedulerImpl) searchAgents(ctx context.Context) error {
	asleepParams := dbaccess.SearchAgentByAsleepDurationAndStatusParams{
		Duration:  utils.ConvertToPgInterval(AgentSleepDuration),
		Statuses:  []string{worker.StatusAsleep},
		MaxAgents: BatchProcessAgentNum,
	}
	asleepAgents, err := dbaccess.Querier.SearchAgentByAsleepDurationAndStatus(ctx, asleepParams)
	if err != nil {
		slog.Error("Scheduler failed to search agents", "error", err)
		return err
	}
	slog.Info("Scheduler found asleep agents", "num_agents", len(asleepAgents))

	// Search for agents that is running but has been awake for a while,
	// probably means they're orphans with no controller
	awakenParams := dbaccess.SearchAgentByAwakeDurationAndStatusParams{
		Duration:  utils.ConvertToPgInterval(AgentAwakeDuration),
		Statuses:  []string{worker.StatusRunning},
		MaxAgents: BatchProcessAgentNum,
	}
	awakenedAgents, err := dbaccess.Querier.SearchAgentByAwakeDurationAndStatus(ctx, awakenParams)
	if err != nil {
		slog.Error("Scheduler failed to search agents", "error", err)
		return err
	}
	slog.Info("Scheduler found awakened agents", "num_agents", len(awakenedAgents))

	for _, agent := range append(asleepAgents, awakenedAgents...) {
		slog.Info("Scheduler handling agent", "agent_id", agent.AgentID)
		if s.onAgentFound == nil {
			slog.Warn("Scheduler: No callback set, skipping agent", "agent_id", agent.AgentID)
			continue
		}
		s.onAgentFound(agent.AgentID, agent)
	}

	return nil
}
