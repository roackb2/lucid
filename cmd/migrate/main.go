package main

import (
	"flag"
	"fmt"
	"log"
	"os"

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
	flag.Parse()

	// Construct the database URL
	dbURL := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		config.Config.Database.User,
		config.Config.Database.Password,
		config.Config.Database.Host,
		config.Config.Database.Port,
		config.Config.Database.DBName)

	// Create a new migrate instance
	m, err := migrate.New("file://internal/db/migrations", dbURL)
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
}
