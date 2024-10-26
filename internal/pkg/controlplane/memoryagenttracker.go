package controlplane

import "sync"

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
	t.mu.Lock()
	defer t.mu.Unlock()
	t.trackings[agentID] = tracking
}

func (t *MemoryAgentTracker) GetTracking(agentID string) (AgentTracking, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	tracking, ok := t.trackings[agentID]
	return tracking, ok
}

func (t *MemoryAgentTracker) UpdateTracking(agentID string, tracking AgentTracking) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.trackings[agentID] = tracking
}

func (t *MemoryAgentTracker) RemoveTracking(agentID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.trackings, agentID)
}

func (t *MemoryAgentTracker) GetAllTrackings() []AgentTracking {
	t.mu.RLock()
	defer t.mu.RUnlock()
	trackings := make([]AgentTracking, 0, len(t.trackings))
	for _, tracking := range t.trackings {
		trackings = append(trackings, tracking)
	}
	return trackings
}
