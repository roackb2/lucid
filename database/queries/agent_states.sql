-- name: CreateAgentState :exec
INSERT INTO agent_states (agent_id, state, status, awakened_at, asleep_at) VALUES ($1, $2, $3, $4, $5);

-- name: GetAgentState :one
SELECT * FROM agent_states WHERE agent_id = $1;

-- name: UpdateAgentState :exec
UPDATE agent_states SET status = $2, state = $3, awakened_at = $4, asleep_at = $5 WHERE agent_id = $1;

-- name: SearchAgentByStatus :many
SELECT * FROM agent_states WHERE status = $1;

-- name: SearchAgentByAwakeDuration :many
SELECT * FROM agent_states WHERE awakened_at < $1;

-- name: SearchAgentByAsleepDuration :many
SELECT * FROM agent_states WHERE asleep_at < $1;
