-- name: CreateAgentProfile :exec
INSERT INTO agent_profiles (agent_id, profile)
VALUES (@agent_id, @profile);

-- name: GetAgentProfile :one
SELECT *
FROM agent_profiles
WHERE agent_id = @agent_id;

-- name: UpdateAgentProfile :exec
UPDATE agent_profiles
SET profile = @profile
WHERE agent_id = @agent_id;

-- name: SearchAgentProfile :many
SELECT *
FROM agent_profiles
WHERE SIMILARITY(profile, @keyword::text) > 0.3
OR profile ILIKE '%' || @keyword || '%'
OR profile ILIKE ANY(
  SELECT '%' || word || '%'
  FROM UNNEST(STRING_TO_ARRAY(@keyword, ' ')) AS word
);

