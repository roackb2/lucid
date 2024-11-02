package control_plane_test

import (
	"context"
	"testing"
	"time"

	"github.com/roackb2/lucid/internal/pkg/agents"
	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	"github.com/roackb2/lucid/internal/pkg/agents/storage"
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
	// config.LoadConfig("test")
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
	agentController := control_plane.NewAgentController(suite.config, suite.mockStorage, suite.mockNotificationBus, suite.mockAgentTracker)

	suite.mockAgentTracker.EXPECT().AddTracking("test-agent-id", gomock.Any()).Do(func(agentID string, tracking control_plane.AgentTracking) {
		suite.Equal("test-agent-id", tracking.AgentID)
		suite.Equal("running", tracking.Status)
	})

	agentID, err := agentController.RegisterAgent(context.Background(), suite.mockAgent)
	suite.NoError(err)
	suite.Equal("test-agent-id", agentID)
}
