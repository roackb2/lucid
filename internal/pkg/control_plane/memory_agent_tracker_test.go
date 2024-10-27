package control_plane_test

import (
	"fmt"
	"sync"
	"testing"

	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/control_plane"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
)

type MemoryAgentTrackerTestSuite struct {
	suite.Suite
}

func (suite *MemoryAgentTrackerTestSuite) SetupTest() {
	config.LoadConfig("test")
}

func TestMemoryAgentTracker(t *testing.T) {
	tracker := control_plane.NewMemoryAgentTracker()

	t.Run("AddTracking and GetTracking", func(t *testing.T) {
		tracking := control_plane.AgentTracking{
			AgentID: "agent1",
			Status:  "active",
		}
		tracker.AddTracking("agent1", tracking)

		retrieved, ok := tracker.GetTracking("agent1")
		assert.True(t, ok)
		assert.Equal(t, tracking, retrieved)

		_, notFound := tracker.GetTracking("nonexistent")
		assert.False(t, notFound)
	})

	t.Run("UpdateTracking", func(t *testing.T) {
		originalTracking := control_plane.AgentTracking{
			AgentID: "agent2",
			Status:  "active",
		}
		tracker.AddTracking("agent2", originalTracking)

		updatedTracking := control_plane.AgentTracking{
			AgentID: "agent2",
			Status:  "inactive",
		}
		tracker.UpdateTracking("agent2", updatedTracking)

		retrieved, ok := tracker.GetTracking("agent2")
		assert.True(t, ok)
		assert.Equal(t, updatedTracking, retrieved)
	})

	t.Run("RemoveTracking", func(t *testing.T) {
		tracking := control_plane.AgentTracking{
			AgentID: "agent3",
			Status:  "active",
		}
		tracker.AddTracking("agent3", tracking)

		tracker.RemoveTracking("agent3")

		_, ok := tracker.GetTracking("agent3")
		assert.False(t, ok)
	})

	t.Run("GetAllTrackings", func(t *testing.T) {
		tracker.AddTracking("agent4", control_plane.AgentTracking{AgentID: "agent4", Status: "active"})
		tracker.AddTracking("agent5", control_plane.AgentTracking{AgentID: "agent5", Status: "inactive"})

		allTrackings := tracker.GetAllTrackings()
		assert.Len(t, allTrackings, 4) // Including previously added trackings

		agentIDs := make(map[string]bool)
		for _, tracking := range allTrackings {
			agentIDs[tracking.AgentID] = true
		}

		assert.True(t, agentIDs["agent1"])
		assert.True(t, agentIDs["agent2"])
		assert.True(t, agentIDs["agent4"])
		assert.True(t, agentIDs["agent5"])
	})

	t.Run("ThreadSafety", func(t *testing.T) {
		const numGoroutines = 100
		const numOperations = 1000

		var wg sync.WaitGroup
		wg.Add(numGoroutines * 4) // 4 operations per goroutine

		for i := 0; i < numGoroutines; i++ {
			go func(id int) {
				defer wg.Done()

				// Add tracking
				tracker.AddTracking(fmt.Sprintf("agent%d", id), control_plane.AgentTracking{
					AgentID: fmt.Sprintf("agent%d", id),
					Status:  "active",
				})
			}(i)

			go func(id int) {
				defer wg.Done()

				// Get tracking
				for j := 0; j < numOperations; j++ {
					tracker.GetTracking(fmt.Sprintf("agent%d", id))
				}
			}(i)

			go func(id int) {
				defer wg.Done()

				// Update tracking
				for j := 0; j < numOperations; j++ {
					tracker.UpdateTracking(fmt.Sprintf("agent%d", id), control_plane.AgentTracking{
						AgentID: fmt.Sprintf("agent%d", id),
						Status:  "updated",
					})
				}
			}(i)

			go func(id int) {
				defer wg.Done()

				// Get all trackings
				for j := 0; j < numOperations; j++ {
					tracker.GetAllTrackings()
				}
			}(i)
		}

		wg.Wait()

		// Verify the final state
		allTrackings := tracker.GetAllTrackings()
		assert.Len(t, allTrackings, numGoroutines)

		for _, tracking := range allTrackings {
			assert.Equal(t, "updated", tracking.Status)
		}
	})
}
