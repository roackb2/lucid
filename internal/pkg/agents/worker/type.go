// Package worker provides the Worker interface and its implementations,
// which are responsible for managing agent behavior and state in the system.
//
// A Worker represents the fundamental component of an agent.
// It manages the execution of tasks, handles commands from the control plane,
// and maintains the agent's internal state, including chat history and tasks.
//
// Important:
// - A Worker instance is intended for one-time task execution per Chat or ResumeChat call.
// - Users should close the Worker after the task is done using Close().
// - Do NOT reuse the same Worker instance after closing.
// - The Worker interface is not safe for concurrent use by multiple goroutines.
//   Ensure that calls to a Worker instance are properly synchronized.

package worker

import "context"

// CommandCallback defines the function signature for command callbacks.
// It receives the agent ID and the current status.
type CommandCallback func(agentID string, status string)

// Agent roles within the system.
const (
	// RolePublisher represents an agent that publishes data.
	RolePublisher = "publisher"
	// RoleConsumer represents an agent that consumes data.
	RoleConsumer = "consumer"
)

// Commands that can be sent to a Worker.
const (
	// CmdPause instructs the Worker to pause execution.
	CmdPause = "pause"
	// CmdResume instructs the Worker to resume execution.
	CmdResume = "resume"
	// CmdSleep instructs the Worker to put itself to sleep.
	CmdSleep = "sleep"
	// CmdTerminate instructs the Worker to persist its state and terminate.
	CmdTerminate = "terminate"
)

// Status values representing the Worker's current state.
const (
	// StatusRunning indicates the Worker is currently running.
	StatusRunning = "running"
	// StatusPaused indicates the Worker is currently paused.
	StatusPaused = "paused"
	// StatusAsleep indicates the Worker is currently put to sleep by the control plane.
	StatusAsleep = "asleep"
	// StatusTerminated indicates the Worker has final response and terminated.
	StatusTerminated = "terminated"
)

// WorkerEventKey represents keys for Worker event callbacks.
type WorkerEventKey string

// Event keys for WorkerCallbacks.
const (
	// OnPause is the event key for the pause callback.
	OnPause WorkerEventKey = "onPause"
	// OnResume is the event key for the resume callback.
	OnResume WorkerEventKey = "onResume"
	// OnSleep is the event key for the sleep callback.
	OnSleep WorkerEventKey = "onSleep"
	// OnTerminate is the event key for the terminate callback.
	OnTerminate WorkerEventKey = "onTerminate"
)

// WorkerCallbacks maps WorkerEventKeys to their corresponding CommandCallbacks.
// It allows clients to specify functions to be called on specific events.
type WorkerCallbacks map[WorkerEventKey]CommandCallback

// Worker represents the fundamental component of an agent within the system.
// It is responsible for managing the agent's behavior and state.
//
// Responsibilities:
//   - Runs a Large Language Model (LLM) in a loop until the agent has found
//     useful information or has been terminated.
//   - Handles flow control commands from the control plane.
//   - Manages the agent's internal state, including chat history and current tasks.
//   - Persists agent state upon termination and restores state when resumed.
//
// Important:
//   - A Worker instance is intended for one-time task execution per Chat or ResumeChat call.
//   - Users should close the Worker after the task is done using Close().
//   - Do NOT reuse the same Worker instance after closing.
//   - The Worker interface is not safe for concurrent use by multiple goroutines.
//     Ensure that calls to a Worker instance are properly synchronized.
type Worker interface {
	// Chat starts a new chat session with the Worker.
	//
	// Parameters:
	// - ctx: The context used for cancellation and timeouts.
	// - prompt: The initial prompt to start the chat session.
	// - callbacks: A map of WorkerEventKey to CommandCallback for handling events.
	//
	// Returns:
	// - A string containing the Worker's response.
	// - An error if the chat session could not be started or completed.
	//
	// Note:
	// Do not call Chat after the Worker has been closed.
	Chat(ctx context.Context, prompt string, callbacks WorkerCallbacks) (string, error)

	// ResumeChat resumes a previously saved chat session.
	//
	// Parameters:
	// - ctx: The context used for cancellation and timeouts.
	// - newPrompt: An optional new prompt to add to the chat history.
	//   If newPrompt is nil, the chat resumes without adding a new prompt.
	// - callbacks: A map of WorkerEventKey to CommandCallback for handling events.
	//
	// Returns:
	// - A string containing the Worker's response.
	// - An error if the chat session could not be resumed.
	//
	// Note:
	// Do not call ResumeChat after the Worker has been closed.
	ResumeChat(ctx context.Context, newPrompt *string, callbacks WorkerCallbacks) (string, error)

	// SendCommand sends a command to the Worker.
	//
	// Parameters:
	// - ctx: The context used for cancellation and timeouts.
	// - command: The command to send to the Worker.
	//
	// Returns:
	// - An error if the command could not be sent.
	//
	// Note:
	// SendCommand is idempotent, it will have no effect if the Worker is not running.
	SendCommand(ctx context.Context, command string) error

	// GetStatus returns the current status of the Worker.
	//
	// Returns:
	// - The current status of the Worker.
	GetStatus() string

	// Serialize serializes the Worker's state to a byte slice.
	//
	// Returns:
	// - A byte slice representing the serialized state.
	// - An error if serialization fails.
	Serialize() ([]byte, error)

	// Deserialize deserializes the Worker's state from a byte slice.
	//
	// Parameters:
	// - state: The byte slice containing the serialized state.
	//
	// Returns:
	// - An error if deserialization fails.
	Deserialize(state []byte) error

	// PersistState persists the Worker's state to storage.
	//
	// Returns:
	// - An error if persisting the state fails.
	PersistState() error

	// RestoreState restores the Worker's state from storage.
	//
	// Parameters:
	// - agentID: The ID of the agent whose state is to be restored.
	//
	// Returns:
	// - An error if restoring the state fails.
	RestoreState(agentID string) error

	// Close closes the Worker and releases all associated resources.
	//
	// Note:
	// After calling Close, do not reuse the Worker instance.
	Close()
}
