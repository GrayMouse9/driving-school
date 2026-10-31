package test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"driving-school/backend/internal/storage"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	server "driving-school/backend/internal/realtime"
	"github.com/coder/websocket"
)

func worldValidationDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", "postgres://localhost/unused")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestDevelopmentWorldHasUsableSpawns(t *testing.T) {
	handler, shutdown, err := server.NewGameHandler(worldValidationDB(t), loadFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	if handler == nil {
		t.Fatal("expected world handler")
	}
	shutdown()
}

func TestWorldRejectsDuplicateChunkIDs(t *testing.T) {
	data := []byte(`{"version":"test","chunks":[{"id":"same","version":1,"origin":{"x":0,"z":0},"size":10,"objects":[],"roads":[],"agents":[],"resources":[]},{"id":"same","version":1,"origin":{"x":10,"z":0},"size":10,"objects":[],"roads":[],"agents":[],"resources":[]}]}`)
	_, _, err := server.NewGameHandler(worldValidationDB(t), data)
	if err == nil || !strings.Contains(err.Error(), "duplicate chunk") {
		t.Fatalf("duplicate IDs must be rejected: %v", err)
	}
}

func TestWorldRejectsOverlappingChunks(t *testing.T) {
	data := []byte(`{"version":"test","chunks":[{"id":"first","version":1,"origin":{"x":0,"z":0},"size":10,"objects":[],"roads":[],"agents":[],"resources":[]},{"id":"second","version":1,"origin":{"x":5,"z":0},"size":10,"objects":[],"roads":[],"agents":[],"resources":[]}]}`)
	_, _, err := server.NewGameHandler(worldValidationDB(t), data)
	if err == nil || !strings.Contains(err.Error(), "overlapping chunks") {
		t.Fatalf("overlapping chunks must be rejected: %v", err)
	}
}

func TestWorldRejectsMissingChunkArrays(t *testing.T) {
	data := []byte(`{"version":"test","chunks":[{"id":"c","version":1,"origin":{"x":0,"z":0},"size":10,"resources":[]}]}`)
	_, _, err := server.NewGameHandler(worldValidationDB(t), data)
	if err == nil || !strings.Contains(err.Error(), "invalid chunk") {
		t.Fatalf("missing objects, roads and agents must be rejected: %v", err)
	}
}

func TestDevelopmentWorldBudgetAcrossTransitions(t *testing.T) {
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
	id, err := randomToken(12)
	if err != nil {
		t.Fatal(err)
	}
	token, err := randomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users(id,username,password_hash) VALUES ($1,$1,'test')`, id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.Exec(`DELETE FROM users WHERE id=$1`, id); err != nil {
			t.Error(err)
		}
	})
	hash := sha256.Sum256([]byte(token))
	if _, err := db.Exec(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, hash[:], id); err != nil {
		t.Fatal(err)
	}
	handler, shutdown, err := server.NewGameHandler(db, loadFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(shutdown)
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	headers := http.Header{"Origin": {httpServer.URL}, "Cookie": {"session=" + token}}
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	cookie := &http.Cookie{Name: "session", Value: token}
	for gx := -5; gx < 5; gx++ {
		for gz := -5; gz < 5; gz++ {
			x, z := gx*64+32, gz*64+32
			if _, err := db.Exec(`INSERT INTO player_state(user_id,x,y,z,yaw) VALUES ($1,$2,0,$3,0) ON CONFLICT(user_id) DO UPDATE SET x=EXCLUDED.x,z=EXCLUDED.z`, id, x, z); err != nil {
				t.Fatal(err)
			}
			join := fmt.Sprintf(`{"v":1,"type":"join_world","requestId":"join-%d-%d","payload":{}}`, gx, gz)
			if err := conn.Write(ctx, websocket.MessageText, []byte(join)); err != nil {
				t.Fatal(err)
			}
			_, data, err := conn.Read(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var joined struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(data, &joined); err != nil || joined.Type != "world_joined" {
				t.Fatalf("join: %s, %v", data, err)
			}
			_, data, err = conn.Read(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var area struct {
				Type    string          `json:"type"`
				Payload json.RawMessage `json:"payload"`
			}
			if err := json.Unmarshal(data, &area); err != nil || area.Type != "world_interest" {
				t.Fatalf("interest: %s, %v", data, err)
			}
			var interest worldInterest
			if err := json.Unmarshal(area.Payload, &interest); err != nil {
				t.Fatal(err)
			}
			if len(interest.Chunks) == 0 || interest.Chunks[0].ID != fmt.Sprintf("c_%d_%d", gx, gz) {
				t.Fatalf("wrong current chunk at %d,%d", gx, gz)
			}
			metaReq := httptest.NewRequest(http.MethodGet, "/api/v1/world/manifest", nil)
			metaReq.AddCookie(cookie)
			metaRes := httptest.NewRecorder()
			handler.ServeHTTP(metaRes, metaReq)
			var meta struct {
				Total  int `json:"totalWorldBytes"`
				Budget int `json:"cacheBudgetBytes"`
			}
			if metaRes.Code != 200 {
				t.Fatalf("manifest: %d", metaRes.Code)
			}
			if err := json.Unmarshal(metaRes.Body.Bytes(), &meta); err != nil {
				t.Fatal(err)
			}
			used := metaRes.Body.Len() + len(area.Payload)
			for _, ref := range interest.Chunks {
				chunkReq := httptest.NewRequest(http.MethodGet, "/api/v1/world/chunks/"+ref.ID, nil)
				chunkReq.AddCookie(cookie)
				chunkRes := httptest.NewRecorder()
				handler.ServeHTTP(chunkRes, chunkReq)
				if chunkRes.Code != 200 || chunkRes.Body.Len() != ref.DataBytes {
					t.Fatalf("chunk %s: status %d, bytes %d vs %d", ref.ID, chunkRes.Code, chunkRes.Body.Len(), ref.DataBytes)
				}
				used += ref.DataBytes
			}
			if used > meta.Budget || used*10 > meta.Total {
				t.Fatalf("area exceeds budget at %d,%d: %d / %d", gx, gz, used, meta.Budget)
			}
			leave := fmt.Sprintf(`{"v":1,"type":"leave_world","requestId":"leave-%d-%d","payload":{}}`, gx, gz)
			if err := conn.Write(ctx, websocket.MessageText, []byte(leave)); err != nil {
				t.Fatal(err)
			}
			for {
				_, data, err := conn.Read(ctx)
				if err != nil {
					t.Fatal(err)
				}
				var m struct {
					Type string `json:"type"`
				}
				if err := json.Unmarshal(data, &m); err != nil {
					t.Fatal(err)
				}
				if m.Type == "world_left" {
					break
				}
			}
		}
	}
	if _, err := db.Exec(`UPDATE player_state SET x=32,z=2.5,yaw=0 WHERE user_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"join_world","requestId":"transition-join","payload":{}}`)); err != nil {
		t.Fatal(err)
	}
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var joined struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &joined); err != nil || joined.Type != "world_joined" {
		t.Fatalf("transition join: %s, %v", data, err)
	}
	_, data, err = conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var first struct {
		Type    string        `json:"type"`
		Payload worldInterest `json:"payload"`
	}
	if err := json.Unmarshal(data, &first); err != nil || first.Type != "world_interest" {
		t.Fatalf("initial interest: %s, %v", data, err)
	}
	ids := []string{}
	previous := map[string]bool{}
	for _, chunk := range first.Payload.Chunks {
		ids = append(ids, chunk.ID)
		previous[chunk.ID] = true
	}
	loaded, err := json.Marshal(map[string]any{"v": 1, "type": "world_loaded", "requestId": "transition-loaded", "payload": map[string]any{"revision": first.Payload.Revision, "chunkIds": ids}})
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Write(ctx, websocket.MessageText, loaded); err != nil {
		t.Fatal(err)
	}
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"player_input","payload":{"seq":1,"throttle":1,"brake":0,"steer":0}}`)); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var next struct {
			Type    string        `json:"type"`
			Payload worldInterest `json:"payload"`
		}
		if err := json.Unmarshal(data, &next); err != nil {
			t.Fatal(err)
		}
		if next.Type != "world_interest" {
			continue
		}
		if next.Payload.Revision <= first.Payload.Revision || len(next.Payload.Chunks) == 0 || next.Payload.Chunks[0].ID != "c_0_-1" {
			t.Fatalf("invalid transition: %s", data)
		}
		present := map[string]bool{}
		for _, c := range next.Payload.Chunks {
			present[c.ID] = true
		}
		for _, removed := range next.Payload.RemoveChunkIDs {
			if !previous[removed] || present[removed] {
				t.Fatalf("invalid removed chunk %s", removed)
			}
		}
		break
	}
}
