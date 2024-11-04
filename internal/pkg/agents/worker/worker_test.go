package worker

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/roackb2/lucid/internal/pkg/agents/providers"
	mock_providers "github.com/roackb2/lucid/test/_mocks/providers"
	mock_pubsub "github.com/roackb2/lucid/test/_mocks/pubsub"
	mock_storage "github.com/roackb2/lucid/test/_mocks/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
	"go.uber.org/mock/gomock"
)

type WorkerTestSuite struct {
	suite.Suite
	ctrl                      *gomock.Controller
	mockStorage               *mock_storage.MockStorage
	mockProvider              *mock_providers.MockChatProvider
	mockPubSub                *mock_pubsub.MockPubSub
	worker                    *WorkerImpl
	id                        string
	role                      string
	mockReportResponseContent string
	mockReportResponse        providers.ChatResponse
}

func (s *WorkerTestSuite) SetupTest() {
	s.ctrl = gomock.NewController(s.T())
	s.mockStorage = mock_storage.NewMockStorage(s.ctrl)
	s.mockProvider = mock_providers.NewMockChatProvider(s.ctrl)
	s.mockPubSub = mock_pubsub.NewMockPubSub(s.ctrl)
	s.id = "test-id"
	s.role = "test-role"
	s.worker = NewWorker(&s.id, s.role, s.mockStorage, s.mockProvider, s.mockPubSub)

	s.mockReportResponseContent = "Test response"
	mockToolCallArgs := map[string]string{
		"content": s.mockReportResponseContent,
	}
	mockToolCallArgsString, err := json.Marshal(mockToolCallArgs)
	assert.NoError(s.T(), err)
	s.mockReportResponse = providers.ChatResponse{
		ToolCalls: []providers.ToolCall{
			{
				ID:           "test-tool-call-id",
				FunctionName: "report",
				Args:         string(mockToolCallArgsString),
			},
		},
	}
}

func (s *WorkerTestSuite) TearDownTest() {
	s.ctrl.Finish()
}

func TestWorkerSuite(t *testing.T) {
	suite.Run(t, new(WorkerTestSuite))
}

func (s *WorkerTestSuite) TestNewWorker() {
	assert.NotNil(s.T(), s.worker)
	assert.Equal(s.T(), &s.id, s.worker.ID)
	assert.Equal(s.T(), s.role, s.worker.Role)
	assert.NotNil(s.T(), s.worker.persistTools)
	assert.NotNil(s.T(), s.worker.flowTools)
	assert.NotNil(s.T(), s.worker.controlCh)
}

func (s *WorkerTestSuite) TestChat() {
	// Mock expectations
	s.mockProvider.EXPECT().
		Chat(gomock.Any()).
		Return(s.mockReportResponse, nil)

	s.mockStorage.EXPECT().
		SaveAgentState(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Return(nil)

	s.mockStorage.EXPECT().
		SaveAgentState(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Return(nil).
		AnyTimes()

	s.mockPubSub.EXPECT().
		Publish(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Return(nil).
		AnyTimes()

	doneCh := make(chan struct{}, 1)
	defer close(doneCh)

	callbacks := WorkerCallbacks{}
	go func() {
		actualResponse, err := s.worker.Chat(context.Background(), "test prompt", callbacks)
		assert.NoError(s.T(), err)
		assert.Equal(s.T(), s.mockReportResponseContent, actualResponse)
		doneCh <- struct{}{}
	}()

	<-doneCh
}

func (s *WorkerTestSuite) TestPersistAndRestoreState() {
	// Mock SaveAgentState
	s.mockStorage.EXPECT().
		SaveAgentState(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Return(nil)

	err := s.worker.PersistState()
	assert.NoError(s.T(), err)

	// Mock GetAgentState
	serializedState, _ := s.worker.Serialize()
	s.mockStorage.EXPECT().
		GetAgentState(gomock.Any()).
		Return(serializedState, nil)

	// Mock SaveAgentState for restore
	s.mockStorage.EXPECT().
		SaveAgentState(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
		Return(nil)

	err = s.worker.RestoreState(s.id)
	assert.NoError(s.T(), err)
}
