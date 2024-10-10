-- name: CreateChat :exec
INSERT INTO chats (user_id, content)
VALUES ($1, $2);

-- name: GetChats :many
SELECT * FROM chats WHERE user_id = $1;

