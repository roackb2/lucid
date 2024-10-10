package querier

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/roackb2/lucid/config"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
)

var Querier *dbaccess.Queries

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
