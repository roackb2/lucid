-- name: CreateAgentState :exec
INSERT INTO agent_states (agent_id, state, status, role, awakened_at, asleep_at)
VALUES (@agent_id, @state, @status, @role, @awakened_at, @asleep_at);

-- name: GetAgentState :one
SELECT *
FROM agent_states
WHERE agent_id = @agent_id;

-- name: UpdateAgentState :exec
UPDATE agent_states
SET state = @state, status = @status, role = @role, awakened_at = @awakened_at, asleep_at = @asleep_at
WHERE agent_id = @agent_id;

-- name: SearchAgentByStatus :many
SELECT *
FROM agent_states
WHERE status = @status;

-- name: SearchAgentByAwakeDurationAndStatus :many
SELECT *
FROM agent_states
WHERE awakened_at + @duration::interval < now()
  AND status = ANY(@statuses::varchar[])
ORDER BY awakened_at ASC
LIMIT @max_agents;

-- name: SearchAgentByAsleepDurationAndStatus :many
SELECT *
FROM agent_states
WHERE asleep_at + @duration::interval < now()
  AND status = ANY(@statuses::varchar[])
ORDER BY asleep_at ASC
LIMIT @max_agents;
