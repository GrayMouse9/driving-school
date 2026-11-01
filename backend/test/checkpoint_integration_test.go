package test

import (
	"context"
	"database/sql"
	server "driving-school/backend/internal/realtime"
	"driving-school/backend/internal/storage"
	"encoding/json"
	"github.com/coder/websocket"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCheckpointUsesDatabaseAnswerAndStopsOnWrongChoice(t *testing.T) {
	for _, role := range []string{"P", "K"} {
		t.Run(role, func(t *testing.T) { checkCheckpointContinuation(t, role) })
	}
}

func checkCheckpointContinuation(t *testing.T, role string) {
	dsn := os.Getenv("DRIVING_SCHOOL_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("separate test database required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = storage.InitSchema(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../server-data/world/training-world.json")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan map[string]any, 1)
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseCoach := func() { releaseOnce.Do(func() { close(release) }) }
	defer releaseCoach()
	coach := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if e := json.NewDecoder(r.Body).Decode(&payload); e != nil {
			t.Error(e)
		}
		payload["player_header"] = r.Header.Get("X-Player-ID")
		payload["path"] = r.URL.Path
		started <- payload
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"answer":"Fixture coach explanation"}`))
	}))
	defer coach.Close()
	// Always release the fake service before httptest.Close, even on a failed assertion.
	defer releaseCoach()
	t.Setenv("AI_SERVICE_URL", coach.URL)
	handler, stop, err := server.NewGameHandler(db, data)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	hs := httptest.NewServer(handler)
	defer hs.Close()
	name, _ := randomToken(10)
	body := `{"username":"` + name + `","password":"Checkpoint26"}`
	reg := httptest.NewRecorder()
	handler.ServeHTTP(reg, httptest.NewRequest("POST", "/api/v1/auth/register", strings.NewReader(body)))
	if reg.Code != 201 {
		t.Fatal(reg.Body.String())
	}
	defer func() { stop(); db.Exec(`DELETE FROM users WHERE username=$1`, name) }()
	locationID := "shared-priority-p"
	if role == "K" {
		locationID = "shared-priority-k"
		_, err = db.Exec(`INSERT INTO player_training(user_id,state) SELECT id,'{"role":"K","locationId":"shared-priority-k","phase":"approaching","revision":1}'::jsonb FROM users WHERE username=$1`, name)
		if err != nil {
			t.Fatal(err)
		}
		_, err = db.Exec(`INSERT INTO player_state(user_id,x,y,z,yaw) SELECT id,29.5,0,22,pi() FROM users WHERE username=$1 ON CONFLICT(user_id) DO UPDATE SET x=29.5,z=22,yaw=pi()`, name)
		if err != nil {
			t.Fatal(err)
		}
	}
	login := httptest.NewRecorder()
	handler.ServeHTTP(login, httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(body)))
	cookie := login.Result().Cookies()[0]
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(hs.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {hs.URL}, "Cookie": {cookie.String()}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	send := func(kind, id string, payload any) {
		b, _ := json.Marshal(map[string]any{"v": 1, "type": kind, "requestId": id, "payload": payload})
		if e := conn.Write(ctx, websocket.MessageText, b); e != nil {
			t.Fatal(e)
		}
	}
	read := func(kind string) map[string]any {
		for {
			_, b, e := conn.Read(ctx)
			if e != nil {
				t.Fatalf("waiting for %s: %v", kind, e)
			}
			var m map[string]any
			if json.Unmarshal(b, &m) != nil {
				t.Fatal("invalid envelope")
			}
			if m["type"] == kind {
				return m
			}
		}
	}
	send("join_world", "join", map[string]any{})
	read("world_joined")
	area := read("world_interest")["payload"].(map[string]any)
	ids := []string{}
	for _, c := range area["chunks"].([]any) {
		ids = append(ids, c.(map[string]any)["id"].(string))
	}
	send("world_loaded", "loaded", map[string]any{"revision": area["revision"], "chunkIds": ids})
	read("world_load_status")
	task := read("task_started")["payload"].(map[string]any)
	if task["scenarioId"] != locationID {
		t.Fatalf("unexpected initial task: %v", task)
	}
	if _, err = db.Exec(`UPDATE location SET correct_answer='stop' WHERE player_id=(SELECT id FROM users WHERE username=$1) AND location_id=$2`, name, locationID); err != nil {
		t.Fatal(err)
	}

	answer := func(id, action string) {
		send("answer_submit", id, map[string]any{"taskId": task["taskId"], "sceneRevision": task["sceneRevision"], "answerId": action})
	}
	answer("wrong", "left")
	wrong := read("answer_result")["payload"].(map[string]any)
	if wrong["correct"] != false {
		t.Fatal("cached/client answer overrode database")
	}
	answer("right", "stop")
	right := read("answer_result")["payload"].(map[string]any)
	if right["correct"] != true {
		t.Fatal("database answer not accepted")
	}
	trip := read("trip_state")["payload"].(map[string]any)
	if trip["phase"] != "awaiting_direction" {
		t.Fatalf("S must wait for another key: %v", trip)
	}
	// A correct S must not move until the next distinct direction command.
	snapshot := func() map[string]any {
		return read("players_snapshot")["payload"].(map[string]any)["players"].([]any)[0].(map[string]any)["position"].(map[string]any)
	}
	before := snapshot()
	for i := 0; i < 3; i++ {
		now := snapshot()
		if now["x"] != before["x"] || now["z"] != before["z"] {
			t.Fatal("S resumed movement without a new direction")
		}
	}
	send("npc_message", "feedback", map[string]any{"npcId": task["helperNpcId"], "text": "Объясни мой последний ответ", "taskId": task["taskId"], "sceneRevision": task["sceneRevision"], "purpose": "answer_feedback", "playerId": "spoofed-player"})
	var request map[string]any
	select {
	case request = <-started:
	case <-ctx.Done():
		t.Fatal("coach did not receive request")
	}
	if request["location_id"] != locationID || request["correct_answer"] != "stop" || request["answer"] != "stop" || request["path"] != "/api/coach/action" {
		t.Fatalf("incorrect database context: %v", request)
	}
	var realUserID string
	if err := db.QueryRow(`SELECT id FROM users WHERE username=$1`, name).Scan(&realUserID); err != nil {
		t.Fatal(err)
	}
	if request["player_header"] != realUserID {
		t.Fatal("client identity spoofed coach request")
	}
	send("maneuver_choose", "continue", map[string]any{"locationId": locationID, "sceneRevision": task["sceneRevision"], "action": "left"})
	read("action_result")
	moved := false
	for i := 0; i < 10; i++ {
		now := snapshot()
		if now["x"] != before["x"] || now["z"] != before["z"] {
			moved = true
			break
		}
	}
	if !moved {
		t.Fatal("coach generation blocked the automatic maneuver")
	}
	releaseCoach()
	reply := read("npc_reply")
	if reply["requestId"] != "feedback" || reply["payload"].(map[string]any)["taskId"] != task["taskId"] {
		t.Fatalf("lost reply correlation: %v", reply)
	}

}
