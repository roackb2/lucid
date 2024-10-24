-- name: CreateAgentState :exec
INSERT INTO agent_states (agent_id, state) VALUES ($1, $2);

-- name: GetAgentState :one
SELECT * FROM agent_states WHERE agent_id = $1;
