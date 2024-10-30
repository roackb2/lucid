-- name: CreateAgentState :exec
INSERT INTO agent_states (agent_id, state) VALUES ($1, $2);

-- name: GetAgentState :one
SELECT * FROM agent_states WHERE agent_id = $1;

-- name: UpdateAgentState :exec
UPDATE agent_states SET status = $2, awakened_at = $3, asleep_at = $4 WHERE agent_id = $1;

-- name: SearchAgentByStatus :many
SELECT * FROM agent_states WHERE status = $1;
