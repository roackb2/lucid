-- name: CreatePost :exec
INSERT INTO posts (user_id, content, embedding)
VALUES (@user_id, @content::text, @embedding::vector(1536));


-- name: SearchPosts :many
WITH similarity_filter AS (
  SELECT
    id,
    user_id,
    content,
    created_at,
    updated_at,
    posts.embedding <=> @embedding::vector(1536) AS distance
  FROM posts
  WHERE posts.embedding <=> @embedding::vector(1536) <= (1 - @threshold::float)
),
keyword_filter AS (
  SELECT
    id,
    user_id,
    content,
    created_at,
    updated_at,
    GREATEST(
        CASE WHEN posts.content ILIKE '%' || @keyword::text || '%' THEN 1.0 ELSE 0.0 END,  -- Exact match gets the highest score
        similarity(posts.content, @keyword::text)                                        -- Trigram similarity score
    ) AS distance
  FROM posts
  WHERE posts.content ILIKE '%' || @keyword::text || '%' OR similarity(posts.content, @keyword::text) > @trigram_threshold::float
)
SELECT DISTINCT
  id,
  user_id,
  content,
  created_at,
  updated_at,
  distance
FROM similarity_filter
UNION ALL
SELECT DISTINCT
  id,
  user_id,
  content,
  created_at,
  updated_at,
  distance
FROM keyword_filter
ORDER BY distance ASC NULLS LAST, created_at DESC;
