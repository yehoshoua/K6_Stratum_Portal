package main

import (
	"log"
	"os"
	"path/filepath"

	"k6-bedrock-dashboard/backend/internal/config"
	"k6-bedrock-dashboard/backend/internal/database"
	"k6-bedrock-dashboard/backend/internal/server"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	dbPath := os.Getenv("DATABASE_PATH")
	if dbPath == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			dbPath = filepath.Join(home, ".k6-bedrock-dashboard", "dashboard.db")
		} else {
			dbPath = "dashboard.db"
		}
	}

	log.Printf("Initializing database at: %s", dbPath)
	db, err := database.InitDB(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Delete the mock EKS cluster if it exists in the database
	if err := db.DeleteCluster("eks-mock-us-west-2"); err != nil {
		log.Printf("Warning: failed to delete mock EKS cluster: %v", err)
	}

	srv := server.NewServer(cfg, db)
	if err := srv.Start(); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
