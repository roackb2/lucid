-- name: CreateAgentState :exec
INSERT INTO agent_states (agent_id, state, status, awakened_at, asleep_at) VALUES (@agent_id, @state, @status, @awakened_at, @asleep_at);

-- name: GetAgentState :one
SELECT *
FROM agent_states
WHERE agent_id = @agent_id;

-- name: UpdateAgentState :exec
UPDATE agent_states
SET status = @status, state = @state, awakened_at = @awakened_at, asleep_at = @asleep_at
WHERE agent_id = @agent_id;

-- name: SearchAgentByStatus :many
SELECT *
FROM agent_states
WHERE status = @status;

-- name: SearchAgentByAwakeDuration :many
SELECT *
FROM agent_states
WHERE awakened_at + @duration::interval < now()
ORDER BY awakened_at ASC
LIMIT @max_agents;

-- name: SearchAgentByAsleepDuration :many
SELECT *
FROM agent_states
WHERE asleep_at + @duration::interval < now()
ORDER BY asleep_at ASC
LIMIT @max_agents;
