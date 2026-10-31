package realtime

import (
	"bytes"
	"context"
	"database/sql"
	"driving-school/backend/internal/auth"
	"driving-school/backend/internal/httpx"
	"driving-school/backend/internal/player"
	"driving-school/backend/internal/progress"
	"driving-school/backend/internal/storage"
	"driving-school/backend/internal/world"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
)

type vec3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}
type playerView struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	Position  vec3    `json:"position"`
	Yaw       float64 `json:"yaw"`
	VehicleID string  `json:"vehicleId"`
}
type vehicleView struct {
	ID         string  `json:"id"`
	DriverID   *string `json:"driverId"`
	Variant    string  `json:"variant"`
	Controller string  `json:"controller"`
	Position   vec3    `json:"position"`
	Yaw        float64 `json:"yaw"`
	Speed      float64 `json:"speed"`
}
type gamePlayer struct {
	user           user
	conn           *websocket.Conn
	outgoing       chan envelope
	session        [32]byte
	slot           int
	car            player.Vehicle
	y              float64
	input          player.Input
	lastSeq        int64
	hasSeq         bool
	inputWindow    time.Time
	inputCount     int
	chatWindow     time.Time
	chatCount      int
	disconnectedAt time.Time
	interest       world.Interest
	confirmed      map[string]bool
	previousChunk  string
	tickBase       int64
	persistFailed  bool
	fetchFailures  int
	worldBlocked   bool
}
type game struct {
	mu      sync.Mutex
	w       *world.World
	db      *sql.DB
	players map[string]*gamePlayer
	tick    int64
	stop    chan struct{}
	done    chan struct{}
}

func NewGameHandler(db *sql.DB, worldData []byte) (http.Handler, func(), error) {
	if db == nil {
		return nil, nil, errors.New("database is required")
	}
	w, err := world.Load(worldData)
	if err != nil {
		return nil, nil, err
	}
	if len(w.Spawns) < 3 {
		return nil, nil, errors.New("world requires at least three spawn points")
	}
	g := &game{w: w, db: db, players: make(map[string]*gamePlayer), stop: make(chan struct{}), done: make(chan struct{})}
	hub := newSocketHub()
	hub.game = g
	go g.run()
	var once sync.Once
	shutdown := func() { once.Do(func() { close(g.stop); <-g.done }) }
	return newHandler(db, hub), shutdown, nil
}

func (g *game) join(ctx context.Context, r *http.Request, u user, session [32]byte, conn *websocket.Conn, requestID string, hub *socketHub) error {
	pr, err := progress.Read(r.Context(), g.db, u.ID)
	if err != nil {
		return err
	}
	var x, y, z, yaw float64
	err = storage.LoadPosition(ctx, g.db, u.ID, &x, &y, &z, &yaw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	hasSaved := err == nil
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[u.ID]
	if p == nil {
		used := make(map[int]bool)
		for _, other := range g.players {
			used[other.slot] = true
		}
		savedSafe := hasSaved && player.FiniteRange(y, -1e9, 1e9) && player.FiniteRange(yaw, -1e9, 1e9) && g.positionSafe(x, z, u.ID)
		slot := -1
		for i, spawn := range g.w.Spawns {
			if !used[i] && (savedSafe || g.positionSafe(spawn.X, spawn.Z, u.ID)) {
				slot = i
				break
			}
		}
		if slot < 0 {
			return errors.New("VEHICLE_BUSY")
		}
		spawn := g.w.Spawns[slot]
		p = &gamePlayer{user: u, slot: slot, car: player.Vehicle{X: spawn.X, Z: spawn.Z, Yaw: spawn.Yaw}, y: spawn.Y, lastSeq: -1}
		if savedSafe {
			p.car.X = x
			p.car.Z = z
			p.car.Yaw = yaw
			p.y = y
		}
		if !g.positionSafe(p.car.X, p.car.Z, u.ID) {
			return errors.New("VEHICLE_BUSY")
		}
		g.players[u.ID] = p
	} else if p.conn != nil && p.conn != conn {
		go p.conn.Close(websocket.StatusCode(4001), "SESSION_REPLACED")
	}
	p.conn = conn
	p.session = session
	p.disconnectedAt = time.Time{}
	p.input = player.Input{}
	p.lastSeq = -1
	p.hasSeq = false
	p.tickBase = g.tick
	p.confirmed = make(map[string]bool)
	interest, err := g.w.Interest(p.car.X, p.car.Z, p.interest.Revision+1, nil)
	if err != nil {
		delete(g.players, u.ID)
		return err
	}
	p.interest = interest
	p.previousChunk = g.chunkAt(p.car.X, p.car.Z)
	hub.mu.Lock()
	p.outgoing = hub.writers[conn]
	hub.mu.Unlock()
	if p.outgoing == nil {
		return errors.New("connection writer unavailable")
	}
	player := g.playerView(p)
	vehicle := g.vehicleView(p)
	payload, err := json.Marshal(map[string]any{"selfId": u.ID, "tickRate": 20, "player": player, "vehicles": []vehicleView{vehicle}, "progress": pr, "episode": nil, "activeTask": nil})
	if err != nil {
		return err
	}
	if !hub.reply(ctx, conn, session, envelope{Version: 1, Type: "world_joined", RequestID: requestID, Payload: payload}) {
		return errors.New("connection write failed")
	}
	data, err := json.Marshal(interest)
	if err != nil {
		return err
	}
	if !g.enqueue(p, envelope{Version: 1, Type: "world_interest", Payload: data}) {
		return errors.New("connection write failed")
	}
	return nil
}

func writeEvents(ctx context.Context, conn *websocket.Conn, outgoing <-chan envelope) {
	for {
		select {
		case <-ctx.Done():
			return
		case message := <-outgoing:
			if !socketWrite(ctx, conn, message) {
				conn.CloseNow()
				return
			}
		}
	}
}

func (g *game) enqueue(p *gamePlayer, message envelope) bool {
	if p.conn == nil || p.outgoing == nil {
		return false
	}
	select {
	case p.outgoing <- message:
		return true
	default:
		conn := p.conn
		p.outgoing = nil
		go conn.Close(websocket.StatusPolicyViolation, "slow client")
		return false
	}
}

func (g *game) playerView(p *gamePlayer) playerView {
	return playerView{ID: p.user.ID, Username: p.user.Username, Position: vec3{X: p.car.X, Y: p.y, Z: p.car.Z}, Yaw: p.car.Yaw, VehicleID: "vehicle-" + p.user.ID}
}
func (g *game) vehicleView(p *gamePlayer) vehicleView {
	id := p.user.ID
	variants := []string{"blue", "green", "yellow"}
	return vehicleView{ID: "vehicle-" + id, DriverID: &id, Variant: variants[p.slot%len(variants)], Controller: "player", Position: vec3{X: p.car.X, Y: p.y, Z: p.car.Z}, Yaw: p.car.Yaw, Speed: p.car.Speed}
}
func (g *game) chunkAt(x, z float64) string {
	for id, c := range g.w.Chunks {
		if x >= c.X && x < c.X+c.Size && z >= c.Z && z < c.Z+c.Size {
			return id
		}
	}
	return ""
}
func (g *game) positionSafe(x, z float64, ignore string) bool {
	if g.chunkAt(x, z) == "" || math.IsNaN(x) || math.IsNaN(z) || math.IsInf(x, 0) || math.IsInf(z, 0) {
		return false
	}
	for _, c := range g.w.Chunks {
		for _, b := range c.Obstacles {
			if player.IntersectsBox(x, z, player.Radius, b) {
				return false
			}
		}
	}
	for id, p := range g.players {
		if id != ignore && math.Hypot(x-p.car.X, z-p.car.Z) < 2*player.Radius {
			return false
		}
	}
	return true
}

func (g *game) disconnect(userID string, conn *websocket.Conn) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if p := g.players[userID]; p != nil && p.conn == conn {
		p.outgoing = nil
		p.conn = nil
		p.input = player.Input{}
		p.car.Speed = 0
		p.disconnectedAt = time.Now()
		p.persistFailed = g.save(p) != nil
	}
}

func (g *game) joined(userID string, conn *websocket.Conn) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[userID]
	return p != nil && p.conn == conn
}

func (g *game) leave(ctx context.Context, userID string, conn *websocket.Conn, requestID string, hub *socketHub, session [32]byte) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[userID]
	if p == nil || p.conn != conn {
		return hub.replyError(ctx, conn, session, requestID, "NOT_IN_WORLD", "Сначала войдите в мир")
	}
	if err := g.save(p); err != nil {
		conn.Close(websocket.StatusInternalError, "state save failed")
		return false
	}
	response := envelope{Version: 1, Type: "world_left", RequestID: requestID, Payload: json.RawMessage(`{}`)}
	hub.cache(session, response)
	if !g.enqueue(p, response) {
		return false
	}
	delete(g.players, userID)
	return true
}

func (g *game) worldLoaded(ctx context.Context, userID string, conn *websocket.Conn, message envelope, hub *socketHub, session [32]byte) bool {
	var pld struct {
		Revision int      `json:"revision"`
		ChunkIDs []string `json:"chunkIds"`
	}
	if json.Unmarshal(message.Payload, &pld) != nil || pld.ChunkIDs == nil {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Неверный список участков")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[userID]
	if p == nil || p.conn != conn {
		return hub.replyError(ctx, conn, session, message.RequestID, "NOT_IN_WORLD", "Сначала войдите в мир")
	}
	if pld.Revision != p.interest.Revision {
		return hub.replyError(ctx, conn, session, message.RequestID, "STALE_WORLD_REVISION", "Устаревшая версия области")
	}
	wanted := make(map[string]bool, len(p.interest.Chunks))
	for _, c := range p.interest.Chunks {
		wanted[c.ID] = true
	}
	for _, id := range pld.ChunkIDs {
		if !wanted[id] {
			return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Неверный список участков")
		}
		delete(wanted, id)
	}
	if len(wanted) != 0 {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Неверный список участков")
	}
	if len(p.confirmed) == 0 || p.worldBlocked {
		p.input = player.Input{}
	}
	p.worldBlocked = false
	p.confirmed = make(map[string]bool, len(pld.ChunkIDs))
	for _, id := range pld.ChunkIDs {
		p.confirmed[id] = true
	}
	p.fetchFailures = 0
	data, err := json.Marshal(map[string]any{"revision": pld.Revision, "ready": true})
	if err != nil {
		return false
	}
	return hub.reply(ctx, conn, session, envelope{Version: 1, Type: "world_load_status", RequestID: message.RequestID, Payload: data})
}

func (g *game) worldLoadFailed(ctx context.Context, userID string, conn *websocket.Conn, message envelope, hub *socketHub, session [32]byte) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal(message.Payload, &fields) != nil || len(fields) != 4 || fields["revision"] == nil || fields["code"] == nil || fields["chunkId"] == nil || fields["message"] == nil {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Неверное сообщение загрузки")
	}
	var pld struct {
		Revision int     `json:"revision"`
		Code     string  `json:"code"`
		ChunkID  *string `json:"chunkId"`
		Message  string  `json:"message"`
	}
	if json.Unmarshal(message.Payload, &pld) != nil || (pld.Code != "BUDGET" && pld.Code != "FETCH" && pld.Code != "INVALID_DATA") || utf8.RuneCountInString(pld.Message) > 500 {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Неверное сообщение загрузки")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[userID]
	if p == nil || p.conn != conn {
		return hub.replyError(ctx, conn, session, message.RequestID, "NOT_IN_WORLD", "Сначала войдите в мир")
	}
	if pld.Revision != p.interest.Revision {
		return hub.replyError(ctx, conn, session, message.RequestID, "STALE_WORLD_REVISION", "Устаревшая версия области")
	}
	if pld.ChunkID != nil {
		allowed := false
		for _, c := range p.interest.Chunks {
			if c.ID == *pld.ChunkID {
				allowed = true
				break
			}
		}
		if !allowed {
			return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Неизвестный участок")
		}
		delete(p.confirmed, *pld.ChunkID)
	}
	data, err := json.Marshal(map[string]any{"revision": pld.Revision, "ready": false})
	if err != nil {
		return false
	}
	if !hub.reply(ctx, conn, session, envelope{Version: 1, Type: "world_load_status", RequestID: message.RequestID, Payload: data}) {
		return false
	}
	if pld.Code == "BUDGET" {
		if len(p.interest.Chunks) <= 1 {
			p.input = player.Input{}
			p.car.Speed = 0
			p.worldBlocked = true
			return hub.replyError(ctx, conn, session, "", "WORLD_BUDGET_EXCEEDED", "Недостаточно бюджета данных мира")
		}
		previous := make([]string, 0, len(p.interest.Chunks))
		for _, c := range p.interest.Chunks {
			previous = append(previous, c.ID)
		}
		p.interest.Chunks = append([]world.ChunkRef(nil), p.interest.Chunks[0])
		p.interest.Revision++
		p.interest.RemoveChunkIDs = world.RemovedChunks(previous, p.interest.Chunks)
		for id := range p.confirmed {
			if id != p.interest.Chunks[0].ID {
				delete(p.confirmed, id)
			}
		}
		payload, err := json.Marshal(p.interest)
		if err != nil {
			return false
		}
		g.enqueue(p, envelope{Version: 1, Type: "world_interest", Payload: payload})
		return true
	}
	if pld.Code == "FETCH" && p.fetchFailures == 0 {
		p.fetchFailures++
		go g.retryInterest(userID, conn, pld.Revision)
	}
	return true
}

func (g *game) retryInterest(userID string, conn *websocket.Conn, revision int) {
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-g.stop:
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[userID]
	if p == nil || p.conn != conn || p.interest.Revision != revision {
		return
	}
	p.interest.Revision++
	if data, err := json.Marshal(p.interest); err == nil {
		g.enqueue(p, envelope{Version: 1, Type: "world_interest", Payload: data})
	}
}

func (g *game) chat(ctx context.Context, userID string, conn *websocket.Conn, message envelope, hub *socketHub, session [32]byte) bool {
	var payload struct {
		Text string `json:"text"`
	}
	decoder := json.NewDecoder(bytes.NewReader(message.Payload))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&payload) != nil || strings.TrimSpace(payload.Text) == "" {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Пустое сообщение")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[userID]
	if p == nil || p.conn != conn {
		return hub.replyError(ctx, conn, session, message.RequestID, "NOT_IN_WORLD", "Сначала войдите в мир")
	}
	now := time.Now()
	if now.Sub(p.chatWindow) >= time.Second {
		p.chatWindow = now
		p.chatCount = 0
	}
	p.chatCount++
	if p.chatCount > 2 {
		return hub.replyError(ctx, conn, session, message.RequestID, "RATE_LIMITED", "Слишком много сообщений")
	}
	result, err := json.Marshal(map[string]any{"action": "chat_send", "ok": true})
	if err != nil {
		return false
	}
	if !hub.reply(ctx, conn, session, envelope{Version: 1, Type: "action_result", RequestID: message.RequestID, Payload: result}) {
		return false
	}
	data, err := json.Marshal(map[string]any{"senderId": p.user.ID, "username": p.user.Username, "text": payload.Text, "serverTime": now.UnixMilli()})
	if err != nil {
		return false
	}
	for _, other := range g.players {
		g.enqueue(other, envelope{Version: 1, Type: "chat_message", Payload: data})
	}
	return true
}

func (g *game) receiveInput(ctx context.Context, userID string, conn *websocket.Conn, message envelope) bool {
	var fields map[string]json.RawMessage
	if json.Unmarshal(message.Payload, &fields) != nil || len(fields) != 4 || fields["seq"] == nil || fields["throttle"] == nil || fields["brake"] == nil || fields["steer"] == nil {
		return socketError(ctx, conn, "", "INVALID_MESSAGE", "Неверное управление")
	}
	var input player.Input
	decoder := json.NewDecoder(bytes.NewReader(message.Payload))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || !player.ValidInput(input) {
		return socketError(ctx, conn, "", "INVALID_MESSAGE", "Неверное управление")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[userID]
	if p == nil || p.conn != conn {
		return socketError(ctx, conn, "", "NOT_IN_WORLD", "Сначала войдите в мир")
	}
	now := time.Now()
	if now.Sub(p.inputWindow) >= time.Second {
		p.inputWindow = now
		p.inputCount = 0
	}
	p.inputCount++
	if p.inputCount > 20 {
		return socketError(ctx, conn, "", "RATE_LIMITED", "Слишком много команд")
	}
	if p.hasSeq && input.Seq <= p.lastSeq {
		return true
	}
	p.lastSeq = input.Seq
	p.hasSeq = true
	if len(p.confirmed) > 0 && !p.worldBlocked {
		p.input = input
	} else {
		p.input = player.Input{}
	}
	return true
}
func (g *game) save(p *gamePlayer) error {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := g.db.ExecContext(ctx, `INSERT INTO player_state (user_id,x,y,z,yaw) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO UPDATE SET x=EXCLUDED.X,y=EXCLUDED.y,z=EXCLUDED.Z,yaw=EXCLUDED.yaw`, p.user.ID, p.car.X, p.y, p.car.Z, p.car.Yaw)
	if err != nil {
		fmt.Printf("save player state: %v\n", err)
	}
	return err
}

func (g *game) run() {
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	defer close(g.done)
	for {
		select {
		case <-g.stop:
			g.mu.Lock()
			for _, p := range g.players {
				if err := g.save(p); err != nil {
					p.persistFailed = true
				}
				if p.conn != nil {
					go p.conn.Close(websocket.StatusGoingAway, "server shutdown")
				}
			}
			g.players = make(map[string]*gamePlayer)
			g.mu.Unlock()
			return
		case now := <-ticker.C:
			g.update(now)
		}
	}
}

func (g *game) update(now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.tick++
	for id, p := range g.players {
		if p.conn == nil {
			if p.persistFailed && g.tick%100 == 0 {
				p.persistFailed = g.save(p) != nil
			}
			if !p.disconnectedAt.IsZero() && now.Sub(p.disconnectedAt) >= 10*time.Second {
				delete(g.players, id)
			}
			continue
		}
		if len(p.confirmed) > 0 && !p.persistFailed && !p.worldBlocked {
			obstacles := []player.CollisionBox{}
			for _, c := range g.w.Chunks {
				obstacles = append(obstacles, c.Obstacles...)
			}
			for otherID, other := range g.players {
				if otherID != id {
					obstacles = append(obstacles, player.CollisionBox{X: other.car.X, Z: other.car.Z, Width: 2 * player.Radius, Length: 2 * player.Radius})
				}
			}
			next := player.Step(p.car, p.input, obstacles, 0.05)
			if p.confirmed[g.chunkAt(next.X, next.Z)] {
				p.car = next
			} else {
				p.car.Speed = 0
			}
		}
		currentChunk := g.chunkAt(p.car.X, p.car.Z)
		if currentChunk != p.previousChunk {
			previous := make([]string, 0, len(p.interest.Chunks))
			for _, c := range p.interest.Chunks {
				previous = append(previous, c.ID)
			}
			interest, err := g.w.Interest(p.car.X, p.car.Z, p.interest.Revision+1, previous)
			if err != nil {
				p.input = player.Input{}
				p.car.Speed = 0
				conn := p.conn
				go socketError(context.Background(), conn, "", "WORLD_BUDGET_EXCEEDED", "Недостаточно бюджета данных мира")
			} else {
				allowed := make(map[string]bool)
				for _, c := range interest.Chunks {
					allowed[c.ID] = true
				}
				for id := range p.confirmed {
					if !allowed[id] {
						delete(p.confirmed, id)
					}
				}
				p.interest = interest
				p.previousChunk = currentChunk
				if data, err := json.Marshal(interest); err == nil {
					g.enqueue(p, envelope{Version: 1, Type: "world_interest", Payload: data})
				}
			}
		}
		if g.tick%100 == 0 {
			p.persistFailed = g.save(p) != nil
			if p.persistFailed {
				p.input = player.Input{}
				p.car.Speed = 0
			}
		}
	}
	if g.tick%2 != 0 {
		return
	}
	for _, p := range g.players {
		if p.conn == nil {
			continue
		}
		players := []playerView{}
		vehicles := []vehicleView{}
		allowed := make(map[string]bool)
		for _, c := range p.interest.Chunks {
			allowed[c.ID] = true
		}
		for _, q := range g.players {
			if q == p || allowed[g.chunkAt(q.car.X, q.car.Z)] {
				players = append(players, g.playerView(q))
				vehicles = append(vehicles, g.vehicleView(q))
			}
		}
		payload, err := json.Marshal(map[string]any{"tick": g.tick - p.tickBase, "serverTime": now.UnixMilli(), "ackInputSeq": p.lastSeq, "players": players, "vehicles": vehicles, "pedestrians": []any{}, "signals": []any{}})
		if err == nil {
			g.enqueue(p, envelope{Version: 1, Type: "players_snapshot", Payload: payload})
		}
	}
}

func (g *game) authorizedWorld(w http.ResponseWriter, r *http.Request) *gamePlayer {
	hash, ok := auth.SessionDigest(r)
	if !ok {
		httpx.WriteError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
		return nil
	}
	var valid bool
	if err := g.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now())`, hash[:]).Scan(&valid); err != nil {
		httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
		return nil
	}
	if !valid {
		httpx.WriteError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
		return nil
	}
	for _, p := range g.players {
		if p.session == hash && p.conn != nil {
			return p
		}
	}
	httpx.WriteError(w, 403, "NOT_IN_WORLD", "Сначала войдите в мир")
	return nil
}
func (g *game) serveWorldMeta(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.authorizedWorld(w, r) == nil {
		return
	}
	httpx.WriteJSON(w, 200, g.w.Meta)
}
func (g *game) serveChunk(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.authorizedWorld(w, r)
	if p == nil {
		return
	}
	id := r.PathValue("chunkId")
	chunk, exists := g.w.Chunks[id]
	if !exists {
		httpx.WriteError(w, 404, "NOT_FOUND", "Участок не найден")
		return
	}
	allowed := false
	for _, c := range p.interest.Chunks {
		if c.ID == id {
			allowed = true
			break
		}
	}
	if !allowed {
		httpx.WriteError(w, 403, "OUT_OF_RANGE", "Участок вне доступной области")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if _, err := w.Write(chunk.Data); err != nil {
		fmt.Printf("write world chunk: %v\n", err)
	}
}

func (g *game) serveAsset(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.authorizedWorld(w, r) == nil {
		return
	}
	httpx.WriteError(w, 404, "NOT_FOUND", "Ресурс не найден")
}
