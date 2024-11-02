-- name: CreateUser :exec
INSERT INTO users (username, email, password_hash)
VALUES (@username, @email, @password_hash);

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = @email;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = @id;

-- name: UpdateUser :exec
UPDATE users SET username = @username, email = @email, password_hash = @password_hash WHERE id = @id;

