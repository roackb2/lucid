package dbaccess

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/roackb2/lucid/config"
)

var (
	dbPool  *pgxpool.Pool
	Querier *Queries
)

func Initialize() error {
	pool, err := getDbPool()
	dbPool = pool
	if err != nil {
		slog.Error("Failed to get db pool", "error", err)
		return err
	}
	Querier = New(dbPool)
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
