// Code generated by MockGen. DO NOT EDIT.
// Source: internal/pkg/agents/storage/type.go
//
// Generated by this command:
//
//	mockgen -source internal/pkg/agents/storage/type.go -destination internal/pkg/mocks/storage/mock_type.go
//

// Package mock_storage is a generated GoMock package.
package mock_storage

import (
	reflect "reflect"
	time "time"

	dbaccess "github.com/roackb2/lucid/internal/pkg/dbaccess"
	gomock "go.uber.org/mock/gomock"
)

// MockStorage is a mock of Storage interface.
type MockStorage struct {
	ctrl     *gomock.Controller
	recorder *MockStorageMockRecorder
	isgomock struct{}
}

// MockStorageMockRecorder is the mock recorder for MockStorage.
type MockStorageMockRecorder struct {
	mock *MockStorage
}

// NewMockStorage creates a new mock instance.
func NewMockStorage(ctrl *gomock.Controller) *MockStorage {
	mock := &MockStorage{ctrl: ctrl}
	mock.recorder = &MockStorageMockRecorder{mock}
	return mock
}

// EXPECT returns an object that allows the caller to indicate expected use.
func (m *MockStorage) EXPECT() *MockStorageMockRecorder {
	return m.recorder
}

// Close mocks base method.
func (m *MockStorage) Close() error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "Close")
	ret0, _ := ret[0].(error)
	return ret0
}

// Close indicates an expected call of Close.
func (mr *MockStorageMockRecorder) Close() *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "Close", reflect.TypeOf((*MockStorage)(nil).Close))
}

// GetAgentState mocks base method.
func (m *MockStorage) GetAgentState(agentID string) ([]byte, error) {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "GetAgentState", agentID)
	ret0, _ := ret[0].([]byte)
	ret1, _ := ret[1].(error)
	return ret0, ret1
}

// GetAgentState indicates an expected call of GetAgentState.
func (mr *MockStorageMockRecorder) GetAgentState(agentID any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "GetAgentState", reflect.TypeOf((*MockStorage)(nil).GetAgentState), agentID)
}

// SaveAgentState mocks base method.
func (m *MockStorage) SaveAgentState(agentID string, state []byte, status string, awakenedAt, asleepAt *time.Time) error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "SaveAgentState", agentID, state, status, awakenedAt, asleepAt)
	ret0, _ := ret[0].(error)
	return ret0
}

// SaveAgentState indicates an expected call of SaveAgentState.
func (mr *MockStorageMockRecorder) SaveAgentState(agentID, state, status, awakenedAt, asleepAt any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SaveAgentState", reflect.TypeOf((*MockStorage)(nil).SaveAgentState), agentID, state, status, awakenedAt, asleepAt)
}

// SavePost mocks base method.
func (m *MockStorage) SavePost(content string) error {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "SavePost", content)
	ret0, _ := ret[0].(error)
	return ret0
}

// SavePost indicates an expected call of SavePost.
func (mr *MockStorageMockRecorder) SavePost(content any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SavePost", reflect.TypeOf((*MockStorage)(nil).SavePost), content)
}

// SearchAgentByAsleepDuration mocks base method.
func (m *MockStorage) SearchAgentByAsleepDuration(duration time.Duration) ([]dbaccess.AgentState, error) {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "SearchAgentByAsleepDuration", duration)
	ret0, _ := ret[0].([]dbaccess.AgentState)
	ret1, _ := ret[1].(error)
	return ret0, ret1
}

// SearchAgentByAsleepDuration indicates an expected call of SearchAgentByAsleepDuration.
func (mr *MockStorageMockRecorder) SearchAgentByAsleepDuration(duration any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SearchAgentByAsleepDuration", reflect.TypeOf((*MockStorage)(nil).SearchAgentByAsleepDuration), duration)
}

// SearchAgentByAwakeDuration mocks base method.
func (m *MockStorage) SearchAgentByAwakeDuration(duration time.Duration) ([]dbaccess.AgentState, error) {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "SearchAgentByAwakeDuration", duration)
	ret0, _ := ret[0].([]dbaccess.AgentState)
	ret1, _ := ret[1].(error)
	return ret0, ret1
}

// SearchAgentByAwakeDuration indicates an expected call of SearchAgentByAwakeDuration.
func (mr *MockStorageMockRecorder) SearchAgentByAwakeDuration(duration any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SearchAgentByAwakeDuration", reflect.TypeOf((*MockStorage)(nil).SearchAgentByAwakeDuration), duration)
}

// SearchPosts mocks base method.
func (m *MockStorage) SearchPosts(query string) ([]string, error) {
	m.ctrl.T.Helper()
	ret := m.ctrl.Call(m, "SearchPosts", query)
	ret0, _ := ret[0].([]string)
	ret1, _ := ret[1].(error)
	return ret0, ret1
}

// SearchPosts indicates an expected call of SearchPosts.
func (mr *MockStorageMockRecorder) SearchPosts(query any) *gomock.Call {
	mr.mock.ctrl.T.Helper()
	return mr.mock.ctrl.RecordCallWithMethodType(mr.mock, "SearchPosts", reflect.TypeOf((*MockStorage)(nil).SearchPosts), query)
}
