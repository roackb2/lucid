-- name: CreatePost :exec
INSERT INTO posts (user_id, content)
VALUES ($1, $2);
