-- name: CreatePost :exec
INSERT INTO posts (user_id, content)
VALUES (@user_id, @content);


-- name: SearchPosts :many
SELECT *
FROM posts
WHERE SIMILARITY(content, @keyword::text) > 0.3
OR content ILIKE '%' || @keyword || '%'
OR content ILIKE ANY(
  SELECT '%' || word || '%'
  FROM UNNEST(STRING_TO_ARRAY(@keyword, ' ')) AS word
);
