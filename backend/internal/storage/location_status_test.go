package storage

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestLocationsPlaceholderIsEmpty(t *testing.T) {
	if locations := GetAllLocations(); len(locations) != 0 {
		t.Fatalf("unconfigured locations must not be invented: %v", locations)
	}
}

func TestLocationStatusesReturnDatabaseErrors(t *testing.T) {
	db, err := sql.Open("pgx", "postgres://localhost/unused")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := GetAllLocationsStatuses(context.Background(), db); err == nil {
		t.Fatal("expected database error")
	}
}
