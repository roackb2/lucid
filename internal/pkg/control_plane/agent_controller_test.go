package control_plane_test

import (
	"context"
	"testing"
	"time"

	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/control_plane"
	mock_agents "github.com/roackb2/lucid/test/_mocks/agents"
	mock_control_plane "github.com/roackb2/lucid/test/_mocks/control_plane"
	mock_providers "github.com/roackb2/lucid/test/_mocks/providers"
	mock_storage "github.com/roackb2/lucid/test/_mocks/storage"
	"github.com/stretchr/testify/suite"
	"go.uber.org/mock/gomock"
)

type AgentControllerTestSuite struct {
	suite.Suite
	config              control_plane.AgentControllerConfig
	mockCtrl            *gomock.Controller
	mockStorage         *mock_storage.MockStorage
	mockChatProvider    *mock_providers.MockChatProvider
	mockAgent           *mock_agents.MockAgent
	mockAgentTracker    *mock_control_plane.MockAgentTracker
	mockNotificationBus *mock_control_plane.MockNotificationBus
	originalNewAgent    func(task string, role string, storage storage.Storage, provider providers.ChatProvider) (agents.Agent, error)
	doneCh              chan struct{}
}

func (suite *AgentControllerTestSuite) SetupTest() {
	config.LoadConfig("test")
	suite.config = control_plane.AgentControllerConfig{
		ScanInterval:  1 * time.Second,
		AgentLifeTime: 5 * time.Minute,
		MaxRespChSize: 65536,
	}
	suite.mockCtrl = gomock.NewController(suite.T())
	suite.mockStorage = mock_storage.NewMockStorage(suite.mockCtrl)
	suite.mockChatProvider = mock_providers.NewMockChatProvider(suite.mockCtrl)
	suite.mockAgent = mock_agents.NewMockAgent(suite.mockCtrl)
	suite.mockAgentTracker = mock_control_plane.NewMockAgentTracker(suite.mockCtrl)
	suite.mockNotificationBus = mock_control_plane.NewMockNotificationBus(suite.mockCtrl)
	suite.doneCh = make(chan struct{})

	// Override NewAgentFunc to return the mock agent
	suite.originalNewAgent = control_plane.NewAgentFunc
	control_plane.NewAgentFunc = func(task string, role string, storage storage.Storage, provider providers.ChatProvider) (agents.Agent, error) {
		return suite.mockAgent, nil
	}
}

func (suite *AgentControllerTestSuite) TearDownTest() {
	control_plane.NewAgentFunc = suite.originalNewAgent
	suite.mockCtrl.Finish()
	close(suite.doneCh)
}

func TestAgentController(t *testing.T) {
	suite.Run(t, new(AgentControllerTestSuite))
}

func (suite *AgentControllerTestSuite) TestKickoffAgent() {
	// Set up expectations for StartTask
	mockAgentResponse := &agents.AgentResponse{Id: "test-agent-id", Role: "publisher", Message: "task completed"}
	mockStartTaskFunc := func(ctx context.Context, callbacks worker.WorkerCallbacks) (*agents.AgentResponse, error) {
		go func() {
			suite.doneCh <- struct{}{} // Simulate task completion
		}()
		return mockAgentResponse, nil
	}
	suite.mockAgent.EXPECT().StartTask(gomock.Any(), gomock.Any()).DoAndReturn(mockStartTaskFunc)
	suite.mockAgent.EXPECT().GetID().Return("test-agent-id").AnyTimes()

	// Set up expectations for the agent tracker
	suite.mockAgentTracker.EXPECT().AddTracking("test-agent-id", gomock.Any()).Do(func(agentID string, tracking control_plane.AgentTracking) {
		suite.Equal("test-agent-id", tracking.AgentID)
		suite.Equal("running", tracking.Status)
	})

	// Expect NotificationBus to receive the response
	suite.mockNotificationBus.EXPECT().WriteResponse(gomock.Any()).Do(func(response *agents.AgentResponse) {
		suite.Equal(mockAgentResponse, response)
	})

	// Create AgentController instance with injected mocks
	agentController := control_plane.NewAgentController(suite.config, suite.mockStorage, suite.mockNotificationBus, suite.mockAgentTracker)

	// Run KickoffTask, which triggers StartTask asynchronously
	agentID, err := agentController.KickoffTask(context.Background(), "test task", "publisher", suite.mockChatProvider)
	suite.NoError(err)
	suite.Equal("test-agent-id", agentID)

	// Wait for the result on doneCh to simulate task completion
	select {
	case <-suite.doneCh:
	case <-time.After(2 * time.Second): // Set a timeout to avoid hanging
		suite.Fail("StartTask goroutine did not complete in time")
	}
}
