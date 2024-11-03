// Code generated by MockGen. DO NOT EDIT.
// Source: internal/pkg/control_plane/type.go
//
// Generated by this command:
//
//	mockgen -source internal/pkg/control_plane/type.go -destination test/_mocks/control_plane/mock_type.go
//

// Package mock_control_plane is a generated GoMock package.
package mock_control_plane

import (
	context "context"
	reflect "reflect"

	agent "github.com/roackb2/lucid/internal/pkg/agents/agent"
	providers "github.com/roackb2/lucid/internal/pkg/agents/providers"
	storage "github.com/roackb2/lucid/internal/pkg/agents/storage"
	control_plane "github.com/roackb2/lucid/internal/pkg/control_plane"
	gomock "go.uber.org/mock/gomock"
)

// MockNotificationBus is a mock of NotificationBus interface.
type MockNotificationBus struct {
	ctrl     *gomock.Controller
	recorder *MockNotificationBusMockRecorder
	isgomock struct{}
}

// MockNotificationBusMockRecorder is the mock recorder for MockNotificationBus.
type MockNotificationBusMockRecorder struct {
	mock *MockNotificationBus
}

// NewMockNotificationBus creates a new mock instance.
func NewMockNotificationBus(ctrl *gomock.Controller) *MockNotificationBus {
	mock := &MockNotificationBus{ctrl: ctrl}
	mock.recorder = &MockNotificationBusMockRecorder{mock}
	return mock
}

// EXPECT returns an object that allows the caller to indicate expected use.
func (m *MockNotificationBus) EXPECT() *MockNotificationBusMockRecorder {
	return m.recorder
}

// ReadResponse mocks base method.
func (m *MockNotificationBus) ReadResponse() *agent.AgentResponse {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "ReadResponse")
	ret0, _ := ret[0].(*agent.AgentResponse)
	return ret0
}

// ReadResponse indicates an expected call of ReadResponse.
func (mr *MockNotificationBusMockRecorder) ReadResponse() *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "ReadResponse", reflect.TypeOf((*MockNotificationBus)(nil).ReadResponse))
}

// WriteResponse mocks base method.
func (m *MockNotificationBus) WriteResponse(resp *agent.AgentResponse) error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "WriteResponse", resp)
	ret0, _ := ret[0].(error)
	return ret0
}

// WriteResponse indicates an expected call of WriteResponse.
func (mr *MockNotificationBusMockRecorder) WriteResponse(resp any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "WriteResponse", reflect.TypeOf((*MockNotificationBus)(nil).WriteResponse), resp)
}

// MockAgentTracker is a mock of AgentTracker interface.
type MockAgentTracker struct {
	ctrl     *gomock.Controller
	recorder *MockAgentTrackerMockRecorder
	isgomock struct{}
}

// MockAgentTrackerMockRecorder is the mock recorder for MockAgentTracker.
type MockAgentTrackerMockRecorder struct {
	mock *MockAgentTracker
}

// NewMockAgentTracker creates a new mock instance.
func NewMockAgentTracker(ctrl *gomock.Controller) *MockAgentTracker {
	mock := &MockAgentTracker{ctrl: ctrl}
	mock.recorder = &MockAgentTrackerMockRecorder{mock}
	return mock
}

// EXPECT returns an object that allows the caller to indicate expected use.
func (m *MockAgentTracker) EXPECT() *MockAgentTrackerMockRecorder {
	return m.recorder
}

// AddTracking mocks base method.
func (m *MockAgentTracker) AddTracking(agentID string, tracking control_plane.AgentTracking) {
	m.ctrl.T.Helper()
	m.ctrl.Call(m, "AddTracking", agentID, tracking)
}

// AddTracking indicates an expected call of AddTracking.
func (mr *MockAgentTrackerMockRecorder) AddTracking(agentID, tracking any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "AddTracking", reflect.TypeOf((*MockAgentTracker)(nil).AddTracking), agentID, tracking)
}

// GetAllTrackings mocks base method.
func (m *MockAgentTracker) GetAllTrackings() []control_plane.AgentTracking {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "GetAllTrackings")
	ret0, _ := ret[0].([]control_plane.AgentTracking)
	return ret0
}

// GetAllTrackings indicates an expected call of GetAllTrackings.
func (mr *MockAgentTrackerMockRecorder) GetAllTrackings() *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "GetAllTrackings", reflect.TypeOf((*MockAgentTracker)(nil).GetAllTrackings))
}

// GetTracking mocks base method.
func (m *MockAgentTracker) GetTracking(agentID string) (control_plane.AgentTracking, bool) {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "GetTracking", agentID)
	ret0, _ := ret[0].(control_plane.AgentTracking)
	ret1, _ := ret[1].(bool)
	return ret0, ret1
}

// GetTracking indicates an expected call of GetTracking.
func (mr *MockAgentTrackerMockRecorder) GetTracking(agentID any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "GetTracking", reflect.TypeOf((*MockAgentTracker)(nil).GetTracking), agentID)
}

// RemoveTracking mocks base method.
func (m *MockAgentTracker) RemoveTracking(agentID string) {
	m.ctrl.T.Helper()
	m.ctrl.Call(m, "RemoveTracking", agentID)
}

// RemoveTracking indicates an expected call of RemoveTracking.
func (mr *MockAgentTrackerMockRecorder) RemoveTracking(agentID any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "RemoveTracking", reflect.TypeOf((*MockAgentTracker)(nil).RemoveTracking), agentID)
}

// UpdateTracking mocks base method.
func (m *MockAgentTracker) UpdateTracking(agentID string, tracking control_plane.AgentTracking) {
	m.ctrl.T.Helper()
	m.ctrl.Call(m, "UpdateTracking", agentID, tracking)
}

// UpdateTracking indicates an expected call of UpdateTracking.
func (mr *MockAgentTrackerMockRecorder) UpdateTracking(agentID, tracking any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "UpdateTracking", reflect.TypeOf((*MockAgentTracker)(nil).UpdateTracking), agentID, tracking)
}

// MockAgentController is a mock of AgentController interface.
type MockAgentController struct {
	ctrl     *gomock.Controller
	recorder *MockAgentControllerMockRecorder
	isgomock struct{}
}

// MockAgentControllerMockRecorder is the mock recorder for MockAgentController.
type MockAgentControllerMockRecorder struct {
	mock *MockAgentController
}

// NewMockAgentController creates a new mock instance.
func NewMockAgentController(ctrl *gomock.Controller) *MockAgentController {
	mock := &MockAgentController{ctrl: ctrl}
	mock.recorder = &MockAgentControllerMockRecorder{mock}
	return mock
}

// EXPECT returns an object that allows the caller to indicate expected use.
func (m *MockAgentController) EXPECT() *MockAgentControllerMockRecorder {
	return m.recorder
}

// GetAgentStatus mocks base method.
func (m *MockAgentController) GetAgentStatus(agentID string) (string, error) {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "GetAgentStatus", agentID)
	ret0, _ := ret[0].(string)
	ret1, _ := ret[1].(error)
	return ret0, ret1
}

// GetAgentStatus indicates an expected call of GetAgentStatus.
func (mr *MockAgentControllerMockRecorder) GetAgentStatus(agentID any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "GetAgentStatus", reflect.TypeOf((*MockAgentController)(nil).GetAgentStatus), agentID)
}

// RegisterAgent mocks base method.
func (m *MockAgentController) RegisterAgent(ctx context.Context, agent agent.Agent) (string, error) {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "RegisterAgent", ctx, agent)
	ret0, _ := ret[0].(string)
	ret1, _ := ret[1].(error)
	return ret0, ret1
}

// RegisterAgent indicates an expected call of RegisterAgent.
func (mr *MockAgentControllerMockRecorder) RegisterAgent(ctx, agent any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "RegisterAgent", reflect.TypeOf((*MockAgentController)(nil).RegisterAgent), ctx, agent)
}

// SendCommand mocks base method.
func (m *MockAgentController) SendCommand(ctx context.Context, command string) error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "SendCommand", ctx, command)
	ret0, _ := ret[0].(error)
	return ret0
}

// SendCommand indicates an expected call of SendCommand.
func (mr *MockAgentControllerMockRecorder) SendCommand(ctx, command any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SendCommand", reflect.TypeOf((*MockAgentController)(nil).SendCommand), ctx, command)
}

// Start mocks base method.
func (m *MockAgentController) Start(ctx context.Context) error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "Start", ctx)
	ret0, _ := ret[0].(error)
	return ret0
}

// Start indicates an expected call of Start.
func (mr *MockAgentControllerMockRecorder) Start(ctx any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "Start", reflect.TypeOf((*MockAgentController)(nil).Start), ctx)
}

// MockScheduler is a mock of Scheduler interface.
type MockScheduler struct {
	ctrl     *gomock.Controller
	recorder *MockSchedulerMockRecorder
	isgomock struct{}
}

// MockSchedulerMockRecorder is the mock recorder for MockScheduler.
type MockSchedulerMockRecorder struct {
	mock *MockScheduler
}

// NewMockScheduler creates a new mock instance.
func NewMockScheduler(ctrl *gomock.Controller) *MockScheduler {
	mock := &MockScheduler{ctrl: ctrl}
	mock.recorder = &MockSchedulerMockRecorder{mock}
	return mock
}

// EXPECT returns an object that allows the caller to indicate expected use.
func (m *MockScheduler) EXPECT() *MockSchedulerMockRecorder {
	return m.recorder
}

// SendCommand mocks base method.
func (m *MockScheduler) SendCommand(ctx context.Context, command string) error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "SendCommand", ctx, command)
	ret0, _ := ret[0].(error)
	return ret0
}

// SendCommand indicates an expected call of SendCommand.
func (mr *MockSchedulerMockRecorder) SendCommand(ctx, command any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SendCommand", reflect.TypeOf((*MockScheduler)(nil).SendCommand), ctx, command)
}

// SetCallback mocks base method.
func (m *MockScheduler) SetCallback(callback control_plane.OnAgentFoundCallback) {
	m.ctrl.T.Helper()
	m.ctrl.Call(m, "SetCallback", callback)
}

// SetCallback indicates an expected call of SetCallback.
func (mr *MockSchedulerMockRecorder) SetCallback(callback any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SetCallback", reflect.TypeOf((*MockScheduler)(nil).SetCallback), callback)
}

// Start mocks base method.
func (m *MockScheduler) Start(ctx context.Context) error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "Start", ctx)
	ret0, _ := ret[0].(error)
	return ret0
}

// Start indicates an expected call of Start.
func (mr *MockSchedulerMockRecorder) Start(ctx any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "Start", reflect.TypeOf((*MockScheduler)(nil).Start), ctx)
}

// MockAgentFactory is a mock of AgentFactory interface.
type MockAgentFactory struct {
	ctrl     *gomock.Controller
	recorder *MockAgentFactoryMockRecorder
	isgomock struct{}
}

// MockAgentFactoryMockRecorder is the mock recorder for MockAgentFactory.
type MockAgentFactoryMockRecorder struct {
	mock *MockAgentFactory
}

// NewMockAgentFactory creates a new mock instance.
func NewMockAgentFactory(ctrl *gomock.Controller) *MockAgentFactory {
	mock := &MockAgentFactory{ctrl: ctrl}
	mock.recorder = &MockAgentFactoryMockRecorder{mock}
	return mock
}

// EXPECT returns an object that allows the caller to indicate expected use.
func (m *MockAgentFactory) EXPECT() *MockAgentFactoryMockRecorder {
	return m.recorder
}

// NewConsumerAgent mocks base method.
func (m *MockAgentFactory) NewConsumerAgent(storage storage.Storage, task string, chatProvider providers.ChatProvider) agent.Agent {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "NewConsumerAgent", storage, task, chatProvider)
	ret0, _ := ret[0].(agent.Agent)
	return ret0
}

// NewConsumerAgent indicates an expected call of NewConsumerAgent.
func (mr *MockAgentFactoryMockRecorder) NewConsumerAgent(storage, task, chatProvider any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "NewConsumerAgent", reflect.TypeOf((*MockAgentFactory)(nil).NewConsumerAgent), storage, task, chatProvider)
}

// NewPublisherAgent mocks base method.
func (m *MockAgentFactory) NewPublisherAgent(storage storage.Storage, task string, chatProvider providers.ChatProvider) agent.Agent {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "NewPublisherAgent", storage, task, chatProvider)
	ret0, _ := ret[0].(agent.Agent)
	return ret0
}

// NewPublisherAgent indicates an expected call of NewPublisherAgent.
func (mr *MockAgentFactoryMockRecorder) NewPublisherAgent(storage, task, chatProvider any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "NewPublisherAgent", reflect.TypeOf((*MockAgentFactory)(nil).NewPublisherAgent), storage, task, chatProvider)
}

// MockControlPlane is a mock of ControlPlane interface.
type MockControlPlane struct {
	ctrl     *gomock.Controller
	recorder *MockControlPlaneMockRecorder
	isgomock struct{}
}

// MockControlPlaneMockRecorder is the mock recorder for MockControlPlane.
type MockControlPlaneMockRecorder struct {
	mock *MockControlPlane
}

// NewMockControlPlane creates a new mock instance.
func NewMockControlPlane(ctrl *gomock.Controller) *MockControlPlane {
	mock := &MockControlPlane{ctrl: ctrl}
	mock.recorder = &MockControlPlaneMockRecorder{mock}
	return mock
}

// EXPECT returns an object that allows the caller to indicate expected use.
func (m *MockControlPlane) EXPECT() *MockControlPlaneMockRecorder {
	return m.recorder
}

// KickoffTask mocks base method.
func (m *MockControlPlane) KickoffTask(ctx context.Context, task, role string) error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "KickoffTask", ctx, task, role)
	ret0, _ := ret[0].(error)
	return ret0
}

// KickoffTask indicates an expected call of KickoffTask.
func (mr *MockControlPlaneMockRecorder) KickoffTask(ctx, task, role any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "KickoffTask", reflect.TypeOf((*MockControlPlane)(nil).KickoffTask), ctx, task, role)
}

// SendCommand mocks base method.
func (m *MockControlPlane) SendCommand(ctx context.Context, command string) error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "SendCommand", ctx, command)
	ret0, _ := ret[0].(error)
	return ret0
}

// SendCommand indicates an expected call of SendCommand.
func (mr *MockControlPlaneMockRecorder) SendCommand(ctx, command any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SendCommand", reflect.TypeOf((*MockControlPlane)(nil).SendCommand), ctx, command)
}

// Start mocks base method.
func (m *MockControlPlane) Start(ctx context.Context) error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "Start", ctx)
	ret0, _ := ret[0].(error)
	return ret0
}

// Start indicates an expected call of Start.
func (mr *MockControlPlaneMockRecorder) Start(ctx any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "Start", reflect.TypeOf((*MockControlPlane)(nil).Start), ctx)
}
