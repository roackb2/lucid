package querier

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
)

var (
	dbPool  *pgxpool.Pool
	Querier *dbaccess.Queries
)

func Initialize() error {
	pool, err := getDbPool()
	dbPool = pool
	if err != nil {
		slog.Error("Failed to get db pool", "error", err)
		return err
	}
	Querier = dbaccess.New(dbPool)
	return nil
}

func Close() {
	slog.Info("Closing db pool")
	dbPool.Close()
}

func InspectConn() {
	slog.Info("Inspecting connection", "dbPool", dbPool)
}

func getConnString() string {
	return fmt.Sprintf("user=%s password=%s host=%s port=%s dbname=%s sslmode=disable",
		config.Config.Database.User,
		config.Config.Database.Password,
		config.Config.Database.Host,
		config.Config.Database.Port,
		config.Config.Database.DBName,
	)
}

func getDbPool() (*pgxpool.Pool, error) {
	connectionString := getConnString()
	pool, err := pgxpool.New(context.Background(), connectionString)
	if err != nil {
		slog.Error("Failed to create db pool", "error", err)
		return nil, err
	}
	if err := pool.Ping(context.Background()); err != nil {
		slog.Error("Failed to ping db pool", "error", err)
		return nil, err
	}
	slog.Info("Pinged db pool", "dbPool", pool)

	return pool, nil
}

func SearchPosts(query string) ([]dbaccess.Post, error) {
	slog.Info("Searching posts", "query", query)
	var posts []dbaccess.Post
	conn, err := dbPool.Acquire(context.Background())
	if err != nil {
		slog.Error("Failed to acquire connection", "error", err)
		return nil, err
	}
	defer conn.Release()
	rows, err := conn.Query(context.Background(), "SELECT * FROM posts WHERE SIMILARITY(content, $1::text) > 0.3", query)
	if err != nil {
		slog.Error("Failed to query posts", "error", err)
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var post dbaccess.Post
		err := rows.Scan(&post.ID, &post.UserID, &post.Content, &post.CreatedAt, &post.UpdatedAt)
		if err != nil {
			slog.Error("Failed to scan post", "error", err)
			return nil, err
		}
		posts = append(posts, post)
	}
	slog.Info("Found posts", "numPosts", len(posts))
	return posts, nil
}
