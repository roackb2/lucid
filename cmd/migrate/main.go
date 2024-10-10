package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/roackb2/lucid/config"
)

func main() {
	// Define command line flags
	up := flag.Bool("up", false, "Run migrations up")
	down := flag.Bool("down", false, "Run migrations down")
	version := flag.Int("version", -1, "Migrate to a specific version")
	dumpSchema := flag.Bool("dump", false, "Dump database schema after migration")
	flag.Parse()

	// Construct the database URL
	dbURL := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		config.Config.Database.User,
		config.Config.Database.Password,
		config.Config.Database.Host,
		config.Config.Database.Port,
		config.Config.Database.DBName)

	// Create a new migrate instance
	m, err := migrate.New("file://db/migrations", dbURL)
	if err != nil {
		log.Fatal("Error creating migrate instance:", err)
	}
	defer m.Close()

	// Execute the migration based on the provided flags
	if *up {
		if err := m.Up(); err != nil && err != migrate.ErrNoChange {
			log.Fatal("Error running migrations up:", err)
		}
		fmt.Println("Migrations up completed successfully")
	} else if *down {
		if err := m.Down(); err != nil && err != migrate.ErrNoChange {
			log.Fatal("Error running migrations down:", err)
		}
		fmt.Println("Migrations down completed successfully")
	} else if *version >= 0 {
		if err := m.Migrate(uint(*version)); err != nil && err != migrate.ErrNoChange {
			log.Fatal("Error migrating to specific version:", err)
		}
		fmt.Printf("Migration to version %d completed successfully\n", *version)
	} else {
		fmt.Println("Please specify either -up, -down, or -version")
		os.Exit(1)
	}

	// Dump schema if requested
	if *dumpSchema {
		if err := dumpDatabaseSchema(dbURL); err != nil {
			log.Fatal("Error dumping database schema:", err)
		}
		fmt.Println("Database schema dumped successfully")
	}
}

func dumpDatabaseSchema(dbURL string) error {
	dbDir := "db"
	// Set the path for the schema.sql file
	schemaFile := filepath.Join(dbDir, "schema.sql")

	// Create or truncate the schema.sql file
	file, err := os.Create(schemaFile)
	if err != nil {
		return fmt.Errorf("failed to create schema file: %w", err)
	}
	defer file.Close()

	// Run pg_dump to get the schema
	cmd := exec.Command("pg_dump", "-s", "-O", "-x", dbURL)
	cmd.Stdout = file
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to dump schema: %w", err)
	}

	return nil
}
