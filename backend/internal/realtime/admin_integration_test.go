package realtime

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"driving-school/backend/internal/storage"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestAdminAuthorizationAndPromptPostgres(t *testing.T) {
	dsn := os.Getenv("DRIVING_SCHOOL_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRIVING_SCHOOL_TEST_DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := storage.InitSchema(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	name := "admin-integration-user"
	var id string
	if err := db.QueryRow(`INSERT INTO users (id, username, password_hash) VALUES ($1,$1,$2) RETURNING id`, name, "unused").Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE id=$1`, id) })
	token := "admin-test-session"
	hash := sha256.Sum256([]byte(token))
	if _, err := db.Exec(`INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, hash[:], id); err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile("../../testdata/development-world.json")
	if err != nil {
		t.Fatal(err)
	}
	handler, stop, err := NewGameHandler(db, fixture)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	t.Setenv("ADMIN_USER_ID", id)
	t.Setenv("AI_SYSTEM_PROMPT_FILE", filepath.Join(t.TempDir(), "prompt"))
	request := func(method, target, body, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: "session", Value: token})
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := request("GET", "http://example.com/api/v1/admin/state", "", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"players":[]`) {
		t.Fatalf("state: %d %s", w.Code, w.Body.String())
	}
	if w := request("POST", "http://example.com/api/v1/admin/prompt", `{"prompt":"новый"}`, "http://other.example"); w.Code != 403 {
		t.Fatalf("cross-origin write: %d", w.Code)
	}
	if w := request("POST", "http://example.com/api/v1/admin/prompt", `{"prompt":"новый"}`, "http://example.com"); w.Code != 204 {
		t.Fatalf("write: %d %s", w.Code, w.Body.String())
	}
	if w := request("GET", "http://example.com/api/v1/admin/prompt", "", ""); w.Code != 200 || !strings.Contains(w.Body.String(), "новый") {
		t.Fatalf("read: %d %s", w.Code, w.Body.String())
	}
	if w := request("POST", "http://example.com/api/v1/admin/players/missing/location", `{"locationId":"unknown"}`, "http://example.com"); w.Code != 409 {
		t.Fatalf("unconfigured location: %d %s", w.Code, w.Body.String())
	}
	t.Setenv("ADMIN_USER_ID", "another-user")
	if w := request("GET", "http://example.com/api/v1/admin/state", "", ""); w.Code != 403 {
		t.Fatalf("non-admin: %d", w.Code)
	}
}
