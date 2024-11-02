package control_plane

import (
	"log/slog"
	"sync"
)

type MemoryAgentTracker struct {
	trackings map[string]AgentTracking
	mu        sync.RWMutex
}

func NewMemoryAgentTracker() *MemoryAgentTracker {
	return &MemoryAgentTracker{
		trackings: make(map[string]AgentTracking),
	}
}

func (t *MemoryAgentTracker) AddTracking(agentID string, tracking AgentTracking) {
	slog.Debug("MemoryAgentTracker adding tracking", "agent_id", agentID)
	t.mu.Lock()
	defer t.mu.Unlock()
	t.trackings[agentID] = tracking
	slog.Debug("MemoryAgentTracker added tracking", "agent_id", agentID)
}

func (t *MemoryAgentTracker) GetTracking(agentID string) (AgentTracking, bool) {
	slog.Debug("MemoryAgentTracker getting tracking", "agent_id", agentID)
	t.mu.RLock()
	defer t.mu.RUnlock()
	tracking, ok := t.trackings[agentID]
	slog.Debug("MemoryAgentTracker got tracking", "agent_id", agentID, "ok", ok)
	return tracking, ok
}

func (t *MemoryAgentTracker) UpdateTracking(agentID string, tracking AgentTracking) {
	slog.Debug("MemoryAgentTracker updating tracking", "agent_id", agentID)
	t.mu.Lock()
	defer t.mu.Unlock()
	t.trackings[agentID] = tracking
	slog.Debug("MemoryAgentTracker updated tracking", "agent_id", agentID)
}

func (t *MemoryAgentTracker) RemoveTracking(agentID string) {
	slog.Debug("MemoryAgentTracker removing tracking", "agent_id", agentID)
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.trackings, agentID)
	slog.Debug("MemoryAgentTracker removed tracking", "agent_id", agentID)
}

func (t *MemoryAgentTracker) GetAllTrackings() []AgentTracking {
	slog.Debug("MemoryAgentTracker getting all trackings")
	t.mu.RLock()
	defer t.mu.RUnlock()
	trackings := make([]AgentTracking, 0, len(t.trackings))
	for _, tracking := range t.trackings {
		trackings = append(trackings, tracking)
	}
	slog.Debug("MemoryAgentTracker got all trackings", "count", len(trackings))
	return trackings
}
