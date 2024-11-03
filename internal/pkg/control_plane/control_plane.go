package control_plane

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
)

const (
	TickerInterval      = 1 * time.Second
	ControlChannelSize  = 65536
	NewAgentChannelSize = 1000
	SendCommandTimeout  = 3 * time.Second
)

type ControlPlaneImpl struct {
	agentFactory    AgentFactory
	storage         storage.Storage
	chatProvider    providers.ChatProvider
	controller      AgentController
	scheduler       Scheduler
	controlCh       chan string
	newAgentCh      chan agents.Agent
	callbacks       ControlPlaneCallbacks
	workerCallbacks worker.WorkerCallbacks
	stopCmdSent     bool // We should only handle the stop command once
}

func NewControlPlane(
	agentFactory AgentFactory,
	storage storage.Storage,
	chatProvider providers.ChatProvider,
	controller AgentController,
	scheduler Scheduler,
	callbacks ControlPlaneCallbacks,
	workerCallbacks worker.WorkerCallbacks,
) *ControlPlaneImpl {
	return &ControlPlaneImpl{
		agentFactory:    agentFactory,
		chatProvider:    chatProvider,
		controller:      controller,
		scheduler:       scheduler,
		controlCh:       make(chan string, ControlChannelSize),
		newAgentCh:      make(chan agents.Agent, NewAgentChannelSize),
		callbacks:       callbacks,
		workerCallbacks: workerCallbacks,
		stopCmdSent:     false,
	}
}

func (c *ControlPlaneImpl) Start(ctx context.Context) error {
	slog.Info("ControlPlane: Starting")

	// The resumeAgent function will register the agent with the controller
	onAgentFound := func(agentID string, agentState dbaccess.AgentState) {
		slog.Info("ControlPlane: Received new agent", "agent", agentID)
		// TODO: Add role filed to agent_state table and get it from there
		role := "publisher"
		err := c.resumeAgent(ctx, agentID, role, nil)
		if err != nil {
			slog.Error("ControlPlane: Failed to resume agent", "error", err)
		}
	}
	c.scheduler.SetCallback(onAgentFound)

	wg := sync.WaitGroup{}
	wg.Add(2)
	// Start controller and scheduler in separate goroutines
	go func() {
		defer wg.Done()
		err := c.controller.Start(ctx)
		if err != nil {
			slog.Error("ControlPlane: Error starting controller", "error", err)
		}
		slog.Info("ControlPlane: Controller started")
	}()
	go func() {
		defer wg.Done()
		err := c.scheduler.Start(ctx)
		if err != nil {
			slog.Error("ControlPlane: Error starting scheduler", "error", err)
		}
		slog.Info("ControlPlane: Scheduler started")
	}()

	select {
	case <-ctx.Done():
		slog.Info("ControlPlane: Stopping")
		// Controller and scheduler should stop themselves when context is canceled
		// Same for all workers
		return ctx.Err()
	case cmd := <-c.controlCh:
		slog.Info("ControlPlane: Received command", "command", cmd)
		switch cmd {
		case "stop":
			c.stopCmdSent = true
			c.controller.SendCommand(ctx, "stop") // controller is responsible for stopping agents
			c.scheduler.SendCommand(ctx, "stop")
		}
	}

	// Wait for the controller and scheduler to finish
	// The controller should only finish when all agents are terminated
	wg.Wait()

	slog.Info("ControlPlane: Stopped")
	return nil
}

func (c *ControlPlaneImpl) SendCommand(ctx context.Context, command string) error {
	slog.Info("ControlPlane: Sending command", "command", command)
	if c.controlCh == nil {
		slog.Error("ControlPlane: Control channel not initialized")
		return fmt.Errorf("ControlPlane: Control channel not initialized")
	}
	if c.stopCmdSent {
		slog.Warn("ControlPlane: Stop command already sent, ignoring command", "command", command)
		return nil
	}
	select {
	case c.controlCh <- command:
		slog.Info("ControlPlane: Sent command", "command", command)
		return nil
	case <-ctx.Done():
		return fmt.Errorf("ControlPlane: context canceled, cannot send command")
	case <-time.After(SendCommandTimeout):
		return fmt.Errorf("ControlPlane: sending command timed out")
	}
}

// newAgent creates a new agent and registers it with the controller
func (c *ControlPlaneImpl) newAgent(ctx context.Context, task string, role string) (agents.Agent, error) {
	var agent agents.Agent
	switch role {
	case "publisher":
		agent = c.agentFactory.NewPublisher(c.storage, task, c.chatProvider)
	case "consumer":
		agent = c.agentFactory.NewConsumer(c.storage, task, c.chatProvider)
	}
	agentID, err := c.controller.RegisterAgent(ctx, agent)
	if err != nil {
		slog.Error("ControlPlane: Failed to register agent", "error", err)
		return nil, err
	}
	slog.Info("ControlPlane: Registered agent", "agent", agentID)
	return agent, nil
}

// startAgent starts the agent in a new goroutine and handles the final response
func (c *ControlPlaneImpl) startAgent(ctx context.Context, agent agents.Agent) error {
	slog.Info("ControlPlane: Starting agent", "agent", agent.GetID())
	go func() {
		resp, err := agent.StartTask(ctx, c.workerCallbacks)
		if err != nil {
			slog.Error("ControlPlane: Failed to start new agent", "error", err)
			return
		}
		slog.Info("ControlPlane: agent final response", "agent", resp.Id, "response", resp.Message)
		finalResponseCallback, ok := c.callbacks[ControlPlaneEventAgentFinalResponse]
		if !ok {
			slog.Error("ControlPlane: No final response callback set")
			return
		}
		finalResponseCallback(resp.Id, resp.Message)
	}()
	return nil
}

// resumeAgent resumes an agent and handles the final response
func (c *ControlPlaneImpl) resumeAgent(ctx context.Context, agentID string, role string, newPrompt *string) error {
	slog.Info("ControlPlane: Resuming agent", "agent", agentID)
	agent, err := c.newAgent(ctx, "", role)
	if err != nil {
		slog.Error("ControlPlane: Failed to resume agent", "error", err)
		return err
	}
	go func() {
		resp, err := agent.ResumeTask(ctx, agentID, newPrompt, c.workerCallbacks)
		if err != nil {
			slog.Error("ControlPlane: Failed to resume agent", "error", err)
			return
		}
		slog.Info("ControlPlane: agent final response", "agent", resp.Id, "response", resp.Message)
		finalResponseCallback, ok := c.callbacks[ControlPlaneEventAgentFinalResponse]
		if !ok {
			slog.Error("ControlPlane: No final response callback set")
			return
		}
		finalResponseCallback(resp.Id, resp.Message)
	}()
	return nil
}

func (c *ControlPlaneImpl) KickoffTask(ctx context.Context, task string, role string) error {
	slog.Info("ControlPlane: Kickoff task", "task", task, "role", role)
	agent, err := c.newAgent(ctx, task, role)
	if err != nil {
		slog.Error("ControlPlane: Failed to start new agent", "error", err)
		return err
	}
	err = c.startAgent(ctx, agent)
	if err != nil {
		slog.Error("ControlPlane: Failed to start new agent", "error", err)
		return err
	}
	slog.Info("ControlPlane: Started new agent", "agent", agent.GetID())
	return nil
}
