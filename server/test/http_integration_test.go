package test

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	server "driving-school/server"
	"github.com/coder/websocket"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type worldInterest struct {
	Revision       int      `json:"revision"`
	RemoveChunkIDs []string `json:"removeChunkIds"`
	Chunks         []struct {
		ID        string `json:"id"`
		DataBytes int    `json:"dataBytes"`
	} `json:"chunks"`
}
type playerView struct {
	ID       string `json:"id"`
	Position struct {
		Z float64 `json:"z"`
	} `json:"position"`
}

func loadFixture(t *testing.T) []byte {
	t.Helper()
	path := os.Getenv("DRIVING_SCHOOL_TEST_WORLD_FILE")
	if path == "" {
		path = "../testdata/development-world.json"
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func randomToken(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func TestMultiplayerJoinWithPostgres(t *testing.T) {
	dsn := os.Getenv("DRIVING_SCHOOL_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRIVING_SCHOOL_TEST_DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := server.InitSchema(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	fixture := fixtureWithObstacle(t, loadFixture(t))
	handler, shutdown, err := server.NewGameHandler(db, fixture)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(shutdown)
	httpServer := httptest.NewServer(handler)
	t.Cleanup(httpServer.Close)
	var connections []*websocket.Conn
	var playerIDs []string
	var cookies []*http.Cookie
	var areas []worldInterest
	for i := 0; i < 3; i++ {
		name, err := randomToken(12)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			shutdown()
			if _, err := db.Exec(`DELETE FROM users WHERE username=$1`, name); err != nil {
				t.Error(err)
			}
		})
		body := `{"username":"` + name + `","password":"password123"}`
		reg := httptest.NewRecorder()
		handler.ServeHTTP(reg, httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body)))
		if reg.Code != 201 {
			t.Fatalf("register: %d %s", reg.Code, reg.Body.String())
		}
		login := httptest.NewRecorder()
		handler.ServeHTTP(login, httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(body)))
		if login.Code != 200 {
			t.Fatalf("login: %d %s", login.Code, login.Body.String())
		}
		cookie := login.Result().Cookies()[0]
		cookies = append(cookies, cookie)
		beforeJoin := httptest.NewRequest("GET", "/api/v1/world/manifest", nil)
		beforeJoin.AddCookie(cookie)
		beforeJoinResponse := httptest.NewRecorder()
		handler.ServeHTTP(beforeJoinResponse, beforeJoin)
		if beforeJoinResponse.Code != 403 {
			t.Fatalf("world before join: %d", beforeJoinResponse.Code)
		}
		sessionRequest := httptest.NewRequest("GET", "/api/v1/game/session", nil)
		sessionRequest.AddCookie(cookie)
		sessionResponse := httptest.NewRecorder()
		handler.ServeHTTP(sessionResponse, sessionRequest)
		if sessionResponse.Code != 200 {
			t.Fatalf("session: %d %s", sessionResponse.Code, sessionResponse.Body.String())
		}
		progressRequest := httptest.NewRequest("GET", "/api/v1/progress", nil)
		progressRequest.AddCookie(cookie)
		progressResponse := httptest.NewRecorder()
		handler.ServeHTTP(progressResponse, progressRequest)
		if progressResponse.Code != 200 || !strings.Contains(progressResponse.Body.String(), `"lessons":[]`) {
			t.Fatalf("progress: %d %s", progressResponse.Code, progressResponse.Body.String())
		}
		headers := http.Header{"Origin": {httpServer.URL}, "Cookie": {cookie.Name + "=" + cookie.Value}}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		t.Cleanup(cancel)
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: headers})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.CloseNow() })
		if err := conn.Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"join_world","requestId":"join","payload":{}}`)); err != nil {
			t.Fatal(err)
		}
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var response struct {
			Type    string `json:"type"`
			Payload struct {
				SelfID string `json:"selfId"`
				Player struct {
					VehicleID string `json:"vehicleId"`
				} `json:"player"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(data, &response); err != nil || response.Type != "world_joined" || response.Payload.SelfID == "" || response.Payload.Player.VehicleID == "" {
			t.Fatalf("invalid join: %s, %v", data, err)
		}
		connections = append(connections, conn)
		playerIDs = append(playerIDs, response.Payload.SelfID)
		_, data, err = conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var area struct {
			Type    string        `json:"type"`
			Payload worldInterest `json:"payload"`
		}
		if err := json.Unmarshal(data, &area); err != nil || area.Type != "world_interest" || len(area.Payload.Chunks) == 0 {
			t.Fatalf("invalid area: %s, %v", data, err)
		}
		var rawArea struct {
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(data, &rawArea); err != nil {
			t.Fatal(err)
		}
		metaReq := httptest.NewRequest("GET", "/api/v1/world/manifest", nil)
		metaReq.AddCookie(cookie)
		metaResponse := httptest.NewRecorder()
		handler.ServeHTTP(metaResponse, metaReq)
		var meta struct {
			Total  int `json:"totalWorldBytes"`
			Budget int `json:"cacheBudgetBytes"`
		}
		if metaResponse.Code != 200 {
			t.Fatalf("manifest: %d", metaResponse.Code)
		}
		if err := json.Unmarshal(metaResponse.Body.Bytes(), &meta); err != nil {
			t.Fatal(err)
		}
		used := metaResponse.Body.Len() + len(rawArea.Payload)
		for _, c := range area.Payload.Chunks {
			used += c.DataBytes
		}
		if used > meta.Budget || used*10 > meta.Total {
			t.Fatalf("area exceeds budget: %d / %d (total %d)", used, meta.Budget, meta.Total)
		}
		areas = append(areas, area.Payload)
		ids := []string{}
		for _, chunk := range area.Payload.Chunks {
			ids = append(ids, chunk.ID)
		}
		chunkRequest := httptest.NewRequest("GET", "/api/v1/world/chunks/"+ids[0], nil)
		chunkRequest.AddCookie(cookie)
		chunkResponse := httptest.NewRecorder()
		handler.ServeHTTP(chunkResponse, chunkRequest)
		if chunkResponse.Code != 200 || chunkResponse.Body.Len() != area.Payload.Chunks[0].DataBytes {
			t.Fatalf("invalid chunk response: %d, %d bytes", chunkResponse.Code, chunkResponse.Body.Len())
		}
		farRequest := httptest.NewRequest("GET", "/api/v1/world/chunks/c_-5_-5", nil)
		farRequest.AddCookie(cookie)
		farResponse := httptest.NewRecorder()
		handler.ServeHTTP(farResponse, farRequest)
		if farResponse.Code != 403 {
			t.Fatalf("distant chunk was not denied: %d", farResponse.Code)
		}
		confirmation, err := json.Marshal(map[string]any{"v": 1, "type": "world_loaded", "requestId": "loaded", "payload": map[string]any{"revision": area.Payload.Revision, "chunkIds": ids}})
		if err != nil {
			t.Fatal(err)
		}
		if err := conn.Write(ctx, websocket.MessageText, confirmation); err != nil {
			t.Fatal(err)
		}
	}
	if playerIDs[0] == playerIDs[1] || playerIDs[0] == playerIDs[2] || playerIDs[1] == playerIDs[2] {
		t.Fatal("players must have distinct IDs")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if len(areas[2].Chunks) < 2 {
		t.Fatal("test world must allow more than one chunk")
	}
	failure, err := json.Marshal(map[string]any{"v": 1, "type": "world_load_failed", "requestId": "stale", "payload": map[string]any{"revision": 0, "code": "BUDGET", "chunkId": nil, "message": "test"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := connections[2].Write(ctx, websocket.MessageText, failure); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, err := connections[2].Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var m struct {
			Type      string `json:"type"`
			RequestID string `json:"requestId"`
			Payload   struct {
				Code string `json:"code"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		if m.RequestID == "stale" {
			if m.Type != "server_error" || m.Payload.Code != "STALE_WORLD_REVISION" {
				t.Fatalf("invalid stale response: %s", data)
			}
			break
		}
	}
	failure, err = json.Marshal(map[string]any{"v": 1, "type": "world_load_failed", "requestId": "budget", "payload": map[string]any{"revision": areas[2].Revision, "code": "BUDGET", "chunkId": nil, "message": "test"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := connections[2].Write(ctx, websocket.MessageText, failure); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, err := connections[2].Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var m struct {
			Type    string        `json:"type"`
			Payload worldInterest `json:"payload"`
		}
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		if m.Type == "world_interest" {
			if m.Payload.Revision != areas[2].Revision+1 || len(m.Payload.Chunks) != 1 {
				t.Fatalf("invalid reduced area: %s", data)
			}
			break
		}
	}
	if err := connections[0].Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"player_input","payload":{"seq":1,"throttle":1,"brake":0,"steer":0}}`)); err != nil {
		t.Fatal(err)
	}
	moved := false
	for !moved {
		_, data, err := connections[1].Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var snapshot struct {
			Type    string `json:"type"`
			Payload struct {
				Players []playerView `json:"players"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(data, &snapshot); err != nil {
			t.Fatal(err)
		}
		if snapshot.Type != "players_snapshot" {
			continue
		}
		for _, p := range snapshot.Payload.Players {
			if p.ID == playerIDs[0] && p.Position.Z < 31.95 {
				moved = true
			}
		}
	}
	checkPhysics(t, ctx, connections[0], connections[1], playerIDs[0])
	for _, raw := range []string{
		`{"v":1,"type":"chat_send","requestId":"chat-1","payload":{"text":"hello"}}`,
		`{"v":1,"type":"chat_send","requestId":"chat-1","payload":{"text":"hello"}}`,
		`{"v":1,"type":"chat_send","requestId":"chat-2","payload":{"text":"sentinel"}}`,
	} {
		if err := connections[0].Write(ctx, websocket.MessageText, []byte(raw)); err != nil {
			t.Fatal(err)
		}
	}
	helloCount := 0
	for {
		_, data, err := connections[1].Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var m struct {
			Type    string `json:"type"`
			Payload struct {
				Text string `json:"text"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		if m.Type != "chat_message" {
			continue
		}
		if m.Payload.Text == "hello" {
			helloCount++
		}
		if m.Payload.Text == "sentinel" {
			break
		}
	}
	if helloCount != 1 {
		t.Fatalf("duplicate chat broadcast %d times", helloCount)
	}
	replacementHeaders := http.Header{"Origin": {httpServer.URL}, "Cookie": {cookies[0].Name + "=" + cookies[0].Value}}
	replacement, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: replacementHeaders})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { replacement.CloseNow() })
	if err := replacement.Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"join_world","requestId":"join-replacement","payload":{}}`)); err != nil {
		t.Fatal(err)
	}
	_, data, err := replacement.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var rejoined struct {
		Type    string `json:"type"`
		Payload struct {
			SelfID string `json:"selfId"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(data, &rejoined); err != nil || rejoined.Type != "world_joined" || rejoined.Payload.SelfID != playerIDs[0] {
		t.Fatalf("invalid replacement: %s, %v", data, err)
	}
	for {
		_, _, err := connections[0].Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) != websocket.StatusCode(4001) {
				t.Fatalf("wrong close status: %v", err)
			}
			break
		}
	}
	connections[0] = replacement
	if err := connections[0].Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"leave_world","requestId":"leave","payload":{}}`)); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, err := connections[0].Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var m struct {
			Type      string `json:"type"`
			RequestID string `json:"requestId"`
		}
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		if m.Type == "world_left" && m.RequestID == "leave" {
			break
		}
	}
	if err := connections[0].Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"join_world","requestId":"rejoin","payload":{}}`)); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, err := connections[0].Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var m struct {
			Type      string `json:"type"`
			RequestID string `json:"requestId"`
			Payload   struct {
				Player playerView `json:"player"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		if m.Type == "world_joined" && m.RequestID == "rejoin" {
			if m.Payload.Player.ID != playerIDs[0] || m.Payload.Player.Position.Z >= 31.95 {
				t.Fatalf("saved position not restored: %s", data)
			}
			break
		}
	}
	shutdown()
	restartedHandler, restartedShutdown, err := server.NewGameHandler(db, fixture)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restartedShutdown)
	restartedServer := httptest.NewServer(restartedHandler)
	t.Cleanup(restartedServer.Close)
	restartHeaders := http.Header{"Origin": {restartedServer.URL}, "Cookie": {cookies[0].Name + "=" + cookies[0].Value}}
	restartedConn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(restartedServer.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: restartHeaders})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { restartedConn.CloseNow() })
	if err := restartedConn.Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"join_world","requestId":"after-restart","payload":{}}`)); err != nil {
		t.Fatal(err)
	}
	_, data, err = restartedConn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var restored struct {
		Type    string `json:"type"`
		Payload struct {
			Player playerView `json:"player"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(data, &restored); err != nil || restored.Type != "world_joined" || restored.Payload.Player.ID != playerIDs[0] || restored.Payload.Player.Position.Z >= 31.95 {
		t.Fatalf("restart did not restore player: %s, %v", data, err)
	}
}

func TestAuthenticationWithPostgres(t *testing.T) {
	dsn := os.Getenv("DRIVING_SCHOOL_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRIVING_SCHOOL_TEST_DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := server.InitSchema(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	name, err := randomToken(12)
	if err != nil {
		t.Fatal(err)
	}
	name = "Анна" + name
	t.Cleanup(func() {
		if _, err := db.Exec(`DELETE FROM users WHERE username=$1`, name); err != nil {
			t.Error(err)
		}
	})
	handler := server.NewHandler(db)
	body := `{"username":"` + name + `","password":"password123"}`
	register := httptest.NewRecorder()
	handler.ServeHTTP(register, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body)))
	if register.Code != 201 || len(register.Result().Cookies()) != 0 {
		t.Fatalf("registration: status %d, body %s", register.Code, register.Body.String())
	}
	var passwordHash string
	if err := db.QueryRow(`SELECT password_hash FROM users WHERE username=$1`, name).Scan(&passwordHash); err != nil {
		t.Fatal(err)
	}
	if passwordHash == "password123" || !strings.HasPrefix(passwordHash, "argon2id-v1:") {
		t.Fatal("password was not stored as an Argon2id hash")
	}
	wrong := httptest.NewRecorder()
	handler.ServeHTTP(wrong, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"`+name+`","password":"incorrect123"}`)))
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password accepted: %d", wrong.Code)
	}
	if _, err := db.Exec(`UPDATE users SET password_hash='invalid' WHERE username=$1`, name); err != nil {
		t.Fatal(err)
	}
	badHash := httptest.NewRecorder()
	handler.ServeHTTP(badHash, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body)))
	if badHash.Code != http.StatusUnauthorized {
		t.Fatalf("malformed hash accepted: %d", badHash.Code)
	}
	if _, err := db.Exec(`UPDATE users SET password_hash=$1 WHERE username=$2`, passwordHash, name); err != nil {
		t.Fatal(err)
	}
	duplicate := httptest.NewRecorder()
	duplicateBody := `{"username":"` + strings.ToUpper(name) + `","password":"password123"}`
	handler.ServeHTTP(duplicate, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(duplicateBody)))
	if duplicate.Code != 409 {
		t.Fatalf("duplicate registration: %d", duplicate.Code)
	}
	login := httptest.NewRecorder()
	handler.ServeHTTP(login, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(duplicateBody)))
	if login.Code != 200 || len(login.Result().Cookies()) != 1 {
		t.Fatalf("login: status %d, body %s", login.Code, login.Body.String())
	}
	cookie := login.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatal("session cookie lacks required attributes")
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	headers := http.Header{}
	headers.Set("Cookie", cookie.Name+"="+cookie.Value)
	headers.Set("Origin", server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	badHeaders := headers.Clone()
	badHeaders.Set("Origin", "http://untrusted.invalid")
	badSocket, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: badHeaders})
	if badSocket != nil {
		badSocket.CloseNow()
	}
	if err == nil || response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("untrusted origin was not rejected: response=%v, error=%v", response, err)
	}
	socket, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		t.Fatalf("websocket: %v", err)
	}
	defer socket.CloseNow()
	if err := socket.Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"ping","payload":{"clientTime":123}}`)); err != nil {
		t.Fatal(err)
	}
	_, data, err := socket.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var pong struct {
		Type    string `json:"type"`
		Payload struct {
			ClientTime int `json:"clientTime"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(data, &pong); err != nil || pong.Type != "pong" || pong.Payload.ClientTime != 123 {
		t.Fatalf("invalid pong: %s, %v", data, err)
	}
	profileReq := httptest.NewRequest(http.MethodGet, "/api/v1/profile", nil)
	profileReq.AddCookie(cookie)
	profile := httptest.NewRecorder()
	handler.ServeHTTP(profile, profileReq)
	if profile.Code != 200 || !strings.Contains(profile.Body.String(), `"lessons":[]`) {
		t.Fatalf("profile: status %d, body %s", profile.Code, profile.Body.String())
	}
	badLogoutReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", strings.NewReader("invalid"))
	badLogoutReq.AddCookie(cookie)
	badLogout := httptest.NewRecorder()
	handler.ServeHTTP(badLogout, badLogoutReq)
	if badLogout.Code != http.StatusBadRequest {
		t.Fatalf("malformed logout accepted: %d", badLogout.Code)
	}
	logoutReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", strings.NewReader(`{}`))
	logoutReq.AddCookie(cookie)
	logout := httptest.NewRecorder()
	handler.ServeHTTP(logout, logoutReq)
	if logout.Code != 204 {
		t.Fatalf("logout: %d", logout.Code)
	}
	if _, _, err := socket.Read(ctx); websocket.CloseStatus(err) != websocket.StatusCode(4003) {
		t.Fatalf("logout did not close socket: %v", err)
	}
	profile = httptest.NewRecorder()
	handler.ServeHTTP(profile, profileReq)
	if profile.Code != 401 {
		t.Fatalf("revoked session: status %d", profile.Code)
	}
}
