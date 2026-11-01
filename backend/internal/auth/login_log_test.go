package auth

import (
	"bytes"
	"context"
	"database/sql"
	"driving-school/backend/internal/storage"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestLoginLogsUserIDOnlyOnSuccess(t *testing.T) {
	dsn := os.Getenv("DRIVING_SCHOOL_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRIVING_SCHOOL_TEST_DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := storage.InitSchema(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	id, err := RandomToken(16)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := HashPassword("password123")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (id,username,password_hash) VALUES ($1,$2,$3)`, id, id, hash); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE id=$1`, id) })
	mux := http.NewServeMux()
	RegisterRoutes(mux, db, func([32]byte, time.Time) {})
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previous) })
	bad := httptest.NewRecorder()
	mux.ServeHTTP(bad, httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"username":"`+id+`","password":"wrong-password"}`)))
	if bad.Code != http.StatusUnauthorized || output.Len() != 0 {
		t.Fatalf("failed login logged or accepted: %d %s", bad.Code, output.String())
	}
	good := httptest.NewRecorder()
	mux.ServeHTTP(good, httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"username":"`+id+`","password":"password123"}`)))
	if good.Code != http.StatusOK || !strings.Contains(output.String(), id) {
		t.Fatalf("successful login not logged: %d %s", good.Code, output.String())
	}
	if strings.Contains(output.String(), "password123") || strings.Contains(output.String(), good.Result().Cookies()[0].Value) {
		t.Fatal("credentials or session leaked to log")
	}
}
