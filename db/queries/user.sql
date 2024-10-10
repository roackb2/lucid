-- name: CreateUser :exec
INSERT INTO users (username, email, password_hash)
VALUES ($1, $2, $3);

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: UpdateUser :exec
UPDATE users SET username = $2, email = $3, password_hash = $4 WHERE id = $1;

