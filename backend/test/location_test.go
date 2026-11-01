package test

import (
	"context"
	"database/sql"
	"driving-school/backend/internal/storage"
	"os"
	"testing"
)

func TestCurrentLocationPostgres(t *testing.T) {
	dsn := os.Getenv("DRIVING_SCHOOL_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRIVING_SCHOOL_TEST_DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	ctx := context.Background()
	if err := storage.InitSchema(ctx, db); err != nil {
		t.Fatal(err)
	}
	name, err := randomToken(12)
	if err != nil {
		t.Fatal(err)
	}
	var id string
	if err := db.QueryRowContext(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1,$2,$3) RETURNING id`, name, name, "test").Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.ExecContext(ctx, `DELETE FROM users WHERE id=$1`, id); err != nil {
			t.Error(err)
		}
	})
	second, err := randomToken(12)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1,$1,$2)`, second, "test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.ExecContext(ctx, `DELETE FROM users WHERE id=$1`, second); err != nil {
			t.Error(err)
		}
	})
	_, found, err := storage.GetCurrentLocation(ctx, db, id)
	if err != nil || found {
		t.Fatalf("expected no location: found=%v err=%v", found, err)
	}
	if err := storage.SetCurrentLocation(ctx, db, id, "chunk-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE location SET description='old', correct_answer='a1' WHERE player_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err := storage.SetCurrentLocation(ctx, db, id, "chunk-b"); err != nil {
		t.Fatal(err)
	}
	if err := storage.SetCurrentLocation(ctx, db, second, "chunk-b"); err != nil {
		t.Fatal(err)
	}
	other, found, err := storage.GetCurrentLocation(ctx, db, second)
	if err != nil || !found || other.LocationID != "chunk-b" {
		t.Fatalf("unexpected second player location: %+v found=%v err=%v", other, found, err)
	}
	location, found, err := storage.GetCurrentLocation(ctx, db, id)
	if err != nil || !found || location.LocationID != "chunk-b" || location.Description.Valid || location.CorrectAnswer.Valid {
		t.Fatalf("unexpected location: %+v found=%v err=%v", location, found, err)
	}
}

func TestCurrentLocationReturnsDatabaseError(t *testing.T) {
	db, err := sql.Open("pgx", "postgres://localhost/unused")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := storage.GetCurrentLocation(context.Background(), db, "player"); err == nil {
		t.Fatal("expected database error")
	}
}
