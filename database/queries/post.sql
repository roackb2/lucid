-- name: CreatePost :exec
INSERT INTO posts (user_id, content)
VALUES (@user_id, @content);
