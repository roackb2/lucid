package querier

import (
	"context"
	"fmt"
	"log"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
)

var (
	Querier *dbaccess.Queries
)

func init() {
	dbPool, err := getDbPool()
	if err != nil {
		log.Fatal(err)
	}
	Querier = dbaccess.New(dbPool)
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
	conn, err := pgxpool.New(context.Background(), connectionString)
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func SearchPosts(query string) ([]dbaccess.Post, error) {
	slog.Info("Searching posts", "query", query)
	dbPool, err := getDbPool()
	if err != nil {
		log.Fatal(err)
	}
	defer dbPool.Close()
	var posts []dbaccess.Post
	rows, err := dbPool.Query(context.Background(), "SELECT * FROM posts WHERE SIMILARITY(content, $1::text) > 0.3", query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var post dbaccess.Post
		err := rows.Scan(&post.ID, &post.UserID, &post.Content, &post.CreatedAt, &post.UpdatedAt)
		if err != nil {
			return nil, err
		}
		posts = append(posts, post)
	}
	return posts, nil
}
