-- name: CreateAgentProfile :exec
INSERT INTO agent_profiles (agent_id, profile, embedding)
VALUES (@agent_id, @profile::text, @embedding::vector(1536));

-- name: GetAgentProfile :one
SELECT *
FROM agent_profiles
WHERE agent_id = @agent_id;

-- name: UpdateAgentProfile :exec
UPDATE agent_profiles
SET profile = @profile::text, embedding = @embedding::vector(1536)
WHERE agent_id = @agent_id;

-- name: SearchAgentProfiles :many
WITH similarity_filter AS (
    SELECT
        *,
        agent_profiles.embedding <=> @embedding::vector(1536) AS distance
    FROM agent_profiles
    WHERE agent_profiles.embedding <=> @embedding::vector(1536) <= (1 - @threshold::float)
),
keyword_filter AS (
    SELECT
        *,
        GREATEST(
            CASE WHEN agent_profiles.profile ILIKE '%' || @keyword::text || '%' THEN 1.0 ELSE 0.0 END,  -- Exact match gets the highest score
            similarity(agent_profiles.profile, @keyword::text)                                         -- Trigram similarity score
        ) AS distance
    FROM agent_profiles
    WHERE agent_profiles.profile ILIKE '%' || @keyword::text || '%' OR similarity(agent_profiles.profile, @keyword::text) > @trigram_threshold::float
)
SELECT DISTINCT
    id,
    agent_id,
    profile,
    created_at,
    updated_at,
    distance
FROM similarity_filter
UNION ALL
SELECT DISTINCT
    id,
    agent_id,
    profile,
    created_at,
    updated_at,
    distance
FROM keyword_filter
ORDER BY distance ASC NULLS LAST, created_at DESC;

