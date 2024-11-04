package control_plane_test

import (
	"context"
	"testing"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents/worker"
	"github.com/roackb2/lucid/internal/pkg/control_plane"
	mock_agent "github.com/roackb2/lucid/test/_mocks/agent"
	mock_control_plane "github.com/roackb2/lucid/test/_mocks/control_plane"
	mock_providers "github.com/roackb2/lucid/test/_mocks/providers"
	mock_storage "github.com/roackb2/lucid/test/_mocks/storage"
	"github.com/stretchr/testify/suite"
	"go.uber.org/mock/gomock"
)

const (
	AgentScanInterval = 10 * time.Millisecond
	AgentLifeTime     = 10 * time.Millisecond
)

type AgentControllerTestSuite struct {
	suite.Suite
	config           control_plane.AgentControllerConfig
	mockCtrl         *gomock.Controller
	mockStorage      *mock_storage.MockStorage
	mockChatProvider *mock_providers.MockChatProvider
	mockAgent        *mock_agent.MockAgent
	mockAgentTracker *mock_control_plane.MockAgentTracker
	doneCh           chan struct{}
}

func (suite *AgentControllerTestSuite) SetupTest() {
	// config.LoadConfig("test")
	suite.config = control_plane.AgentControllerConfig{
		ScanInterval:  AgentScanInterval,
		AgentLifeTime: AgentLifeTime,
		MaxRespChSize: 65536,
	}
	suite.mockCtrl = gomock.NewController(suite.T())
	suite.mockStorage = mock_storage.NewMockStorage(suite.mockCtrl)
	suite.mockChatProvider = mock_providers.NewMockChatProvider(suite.mockCtrl)
	suite.mockAgent = mock_agent.NewMockAgent(suite.mockCtrl)
	suite.mockAgentTracker = mock_control_plane.NewMockAgentTracker(suite.mockCtrl)
	suite.doneCh = make(chan struct{})
}

func (suite *AgentControllerTestSuite) TearDownTest() {
	suite.mockCtrl.Finish()
	close(suite.doneCh)
}

func TestAgentController(t *testing.T) {
	suite.Run(t, new(AgentControllerTestSuite))
}

func (suite *AgentControllerTestSuite) TestRegisterAgent() {
	suite.mockAgent.EXPECT().GetID().Return("test-agent-id").AnyTimes()
	agentController := control_plane.NewAgentController(suite.config, suite.mockStorage, suite.mockAgentTracker)

	suite.mockAgentTracker.EXPECT().AddTracking("test-agent-id", gomock.Any()).Do(func(agentID string, tracking control_plane.AgentTracking) {
		suite.Equal("test-agent-id", tracking.AgentID)
		suite.Equal("running", tracking.Status)
	})

	agentID, err := agentController.RegisterAgent(context.Background(), suite.mockAgent)
	suite.NoError(err)
	suite.Equal("test-agent-id", agentID)
}

func (suite *AgentControllerTestSuite) TestStart() {
	suite.mockAgent.EXPECT().GetID().Return("test-agent-id").AnyTimes()
	agentController := control_plane.NewAgentController(suite.config, suite.mockStorage, suite.mockAgentTracker)

	// First run, agent is running
	suite.mockAgent.EXPECT().GetStatus().Return(worker.StatusRunning)
	suite.mockAgentTracker.EXPECT().GetAllTrackings().Return([]control_plane.AgentTracking{
		{
			AgentID:   "test-agent-id",
			Agent:     suite.mockAgent,
			Status:    worker.StatusRunning,
			CreatedAt: time.Now().Add(-6 * time.Minute),
		},
	})

	suite.mockAgent.EXPECT().SendCommand(gomock.Any(), worker.CmdSleep).Return(nil)
	suite.mockAgentTracker.EXPECT().UpdateTracking("test-agent-id", gomock.Any()).Do(func(agentID string, tracking control_plane.AgentTracking) {
		suite.Equal("test-agent-id", tracking.AgentID)
		suite.Equal(worker.StatusAsleep, tracking.Status)
	})

	// Second run, agent is asleep
	suite.mockAgentTracker.EXPECT().GetAllTrackings().Return([]control_plane.AgentTracking{
		{
			AgentID:   "test-agent-id",
			Agent:     suite.mockAgent,
			Status:    worker.StatusAsleep,
			CreatedAt: time.Now().Add(-6 * time.Minute),
		},
	})
	suite.mockAgent.EXPECT().GetStatus().Return(worker.StatusAsleep)
	suite.mockAgentTracker.EXPECT().RemoveTracking("test-agent-id")

	// For following, no tracking is returned
	suite.mockAgentTracker.EXPECT().GetAllTrackings().Return([]control_plane.AgentTracking{})

	doneCh := make(chan struct{})
	go func() {
		err := agentController.Start(context.Background())
		suite.NoError(err)
		doneCh <- struct{}{}
	}()

	time.Sleep(2 * AgentScanInterval)
	agentController.SendCommand(context.Background(), "stop")

	<-doneCh
}
