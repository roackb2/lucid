// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.27.0
// source: user.sql

package dbaccess

import (
	"context"
)

const createUser = `-- name: CreateUser :exec
INSERT INTO users (username, email, password_hash)
VALUES ($1, $2, $3)
`

type CreateUserParams struct {
	Username     string
	Email        string
	PasswordHash string
}

func (q *Queries) CreateUser(ctx context.Context, arg CreateUserParams) error {
	_, err := q.db.Exec(ctx, createUser, arg.Username, arg.Email, arg.PasswordHash)
	return err
}

const getUserByEmail = `-- name: GetUserByEmail :one
SELECT id, username, email, password_hash, created_at, updated_at FROM users WHERE email = $1
`

func (q *Queries) GetUserByEmail(ctx context.Context, email string) (User, error) {
	row := q.db.QueryRow(ctx, getUserByEmail, email)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Username,
		&i.Email,
		&i.PasswordHash,
		&i.CreatedAt,
		&i.UpdatedAt,
	)
	return i, err
}

const getUserByID = `-- name: GetUserByID :one
SELECT id, username, email, password_hash, created_at, updated_at FROM users WHERE id = $1
`

func (q *Queries) GetUserByID(ctx context.Context, id int32) (User, error) {
	row := q.db.QueryRow(ctx, getUserByID, id)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Username,
		&i.Email,
		&i.PasswordHash,
		&i.CreatedAt,
		&i.UpdatedAt,
	)
	return i, err
}

const updateUser = `-- name: UpdateUser :exec
UPDATE users SET username = $2, email = $3, password_hash = $4 WHERE id = $1
`

type UpdateUserParams struct {
	ID           int32
	Username     string
	Email        string
	PasswordHash string
}

func (q *Queries) UpdateUser(ctx context.Context, arg UpdateUserParams) error {
	_, err := q.db.Exec(ctx, updateUser,
		arg.ID,
		arg.Username,
		arg.Email,
		arg.PasswordHash,
	)
	return err
}
