package querier

import (
	"context"
	"fmt"
	"log"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
)

var (
	Querier *dbaccess.Queries
)

func init() {
	dbConn, err := getDbConn()
	if err != nil {
		log.Fatal(err)
	}
	Querier = dbaccess.New(dbConn)
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

func getDbConn() (*pgx.Conn, error) {
	connectionString := getConnString()
	conn, err := pgx.Connect(context.Background(), connectionString)
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func SearchPosts(query string) ([]dbaccess.Post, error) {
	slog.Info("Searching posts", "query", query)
	dbConn, err := getDbConn()
	if err != nil {
		log.Fatal(err)
	}
	defer dbConn.Close(context.Background())
	var posts []dbaccess.Post
	rows, err := dbConn.Query(context.Background(), "SELECT * FROM posts WHERE SIMILARITY(content, $1::text) > 0.3", query)
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
