package realtime

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"driving-school/backend/internal/httpx"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type socketHub struct {
	mu           sync.Mutex
	connections  map[[32]byte]map[*websocket.Conn]struct{}
	responses    map[[32]byte]map[string]envelope
	revoked      map[[32]byte]bool
	sessionLocks map[[32]byte]*sync.Mutex
	writers      map[*websocket.Conn]chan envelope
	game         *game
}

func newSocketHub() *socketHub {
	return &socketHub{connections: make(map[[32]byte]map[*websocket.Conn]struct{}), responses: make(map[[32]byte]map[string]envelope), revoked: make(map[[32]byte]bool), sessionLocks: make(map[[32]byte]*sync.Mutex), writers: make(map[*websocket.Conn]chan envelope)}
}

func (h *socketHub) cache(session [32]byte, message envelope) {
	if message.RequestID != "" {
		h.mu.Lock()
		if h.responses[session] == nil {
			h.responses[session] = make(map[string]envelope)
		}
		h.responses[session][message.RequestID] = message
		h.mu.Unlock()
	}
}
func (h *socketHub) reply(ctx context.Context, conn *websocket.Conn, session [32]byte, message envelope) bool {
	h.cache(session, message)
	return h.queue(conn, message)
}

func (h *socketHub) queue(conn *websocket.Conn, message envelope) bool {
	h.mu.Lock()
	outgoing := h.writers[conn]
	h.mu.Unlock()
	if outgoing == nil {
		return false
	}
	select {
	case outgoing <- message:
		return true
	default:
		go conn.Close(websocket.StatusPolicyViolation, "slow client")
		return false
	}
}

func (h *socketHub) replyError(ctx context.Context, conn *websocket.Conn, session [32]byte, requestID, code, text string) bool {
	payload, err := json.Marshal(map[string]any{"code": code, "message": text, "retryable": false})
	return err == nil && h.reply(ctx, conn, session, envelope{Version: 1, Type: "server_error", RequestID: requestID, Payload: payload})
}

func (h *socketHub) closeSession(hash [32]byte, expires time.Time) {
	lock := h.lockForSession(hash)
	lock.Lock()
	defer lock.Unlock()
	h.mu.Lock()
	connections := make([]*websocket.Conn, 0, len(h.connections[hash]))
	for c := range h.connections[hash] {
		connections = append(connections, c)
	}
	delete(h.responses, hash)
	h.revoked[hash] = true
	h.mu.Unlock()
	time.AfterFunc(time.Until(expires), func() {
		h.mu.Lock()
		delete(h.revoked, hash)
		delete(h.responses, hash)
		delete(h.sessionLocks, hash)
		h.mu.Unlock()
	})
	for _, c := range connections {
		go c.Close(websocket.StatusCode(4003), "SESSION_EXPIRED")
	}
}

func (h *socketHub) lockForSession(hash [32]byte) *sync.Mutex {
	h.mu.Lock()
	defer h.mu.Unlock()
	lock := h.sessionLocks[hash]
	if lock == nil {
		lock = &sync.Mutex{}
		h.sessionLocks[hash] = lock
	}
	return lock
}

type envelope struct {
	Version   int             `json:"v"`
	Type      string          `json:"type"`
	RequestID string          `json:"requestId,omitempty"`
	Payload   json.RawMessage `json:"payload"`
}

func (h *socketHub) serve(db *sql.DB, w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("session")
	if err != nil || cookie.Value == "" {
		httpx.WriteError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
		return
	}
	if db == nil {
		httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
		return
	}
	hash := sha256.Sum256([]byte(cookie.Value))
	var expires time.Time
	var u user
	err = db.QueryRowContext(r.Context(), `SELECT s.expires_at,u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, hash[:]).Scan(&expires, &u.ID, &u.Username)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
		return
	}
	if err != nil {
		httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
		return
	}
	if r.Header.Get("Origin") == "" {
		httpx.WriteError(w, 403, "FORBIDDEN", "Неверный источник")
		return
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(16 * 1024)
	h.mu.Lock()
	if h.connections[hash] == nil {
		h.connections[hash] = make(map[*websocket.Conn]struct{})
	}
	h.connections[hash][conn] = struct{}{}
	h.mu.Unlock()
	time.AfterFunc(time.Until(expires), func() {
		h.mu.Lock()
		delete(h.responses, hash)
		delete(h.revoked, hash)
		delete(h.sessionLocks, hash)
		h.mu.Unlock()
	})
	defer func() {
		if h.game != nil {
			h.game.disconnect(u.ID, conn)
		}
		h.mu.Lock()
		delete(h.writers, conn)
		delete(h.connections[hash], conn)
		if len(h.connections[hash]) == 0 {
			delete(h.connections, hash)
		}
		h.mu.Unlock()
		conn.CloseNow()
	}()
	var stillValid bool
	if err := db.QueryRowContext(r.Context(), `SELECT EXISTS (SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now())`, hash[:]).Scan(&stillValid); err != nil || !stillValid {
		conn.Close(websocket.StatusCode(4003), "SESSION_EXPIRED")
		return
	}
	ctx, cancel := context.WithDeadline(r.Context(), expires)
	defer cancel()
	outgoing := make(chan envelope, 32)
	h.mu.Lock()
	h.writers[conn] = outgoing
	h.mu.Unlock()
	go writeEvents(ctx, conn, outgoing)
	for {
		readCtx, readCancel := context.WithTimeout(ctx, 30*time.Second)
		kind, data, err := conn.Read(readCtx)
		readCancel()
		if err != nil {
			if ctx.Err() != nil {
				conn.Close(websocket.StatusCode(4003), "SESSION_EXPIRED")
			}
			return
		}
		h.mu.Lock()
		revoked := h.revoked[hash]
		h.mu.Unlock()
		if revoked {
			conn.Close(websocket.StatusCode(4003), "SESSION_EXPIRED")
			return
		}
		var message envelope
		if kind != websocket.MessageText || json.Unmarshal(data, &message) != nil || message.Version != 1 || message.Type == "" || len(message.Payload) == 0 {
			if !socketError(ctx, conn, "", "INVALID_MESSAGE", "Неверное сообщение") {
				return
			}
			continue
		}
		if message.Type == "ping" {
			var p struct {
				ClientTime json.RawMessage `json:"clientTime"`
			}
			if json.Unmarshal(message.Payload, &p) != nil || len(p.ClientTime) == 0 {
				if !socketError(ctx, conn, "", "INVALID_MESSAGE", "Неверный ping") {
					return
				}
				continue
			}
			payload, err := json.Marshal(map[string]any{"clientTime": p.ClientTime, "serverTime": time.Now().UnixMilli()})
			if err != nil {
				return
			}
			if !socketWrite(ctx, conn, envelope{Version: 1, Type: "pong", Payload: payload}) {
				return
			}
			continue
		}
		if message.Type == "telemetry" && h.game != nil {
			measurement, ok := decodeTelemetry(message.Payload)
			if !ok {
				if !socketError(ctx, conn, "", "INVALID_MESSAGE", "Неверная телеметрия") {
					return
				}
				continue
			}
			h.game.mu.Lock()
			if p := h.game.players[u.ID]; p != nil && p.conn == conn {
				p.telemetry, p.telemetryAt = measurement, time.Now()
			}
			h.game.mu.Unlock()
			continue
		}
		if !h.handleMessage(ctx, r, u, hash, conn, message) {
			return
		}
	}
}

func (h *socketHub) handleMessage(ctx context.Context, r *http.Request, u user, hash [32]byte, conn *websocket.Conn, message envelope) bool {
	if message.Type != "player_input" && message.RequestID == "" {
		return socketError(ctx, conn, "", "INVALID_MESSAGE", "Требуется requestId")
	}
	lock := h.lockForSession(hash)
	lock.Lock()
	defer lock.Unlock()
	h.mu.Lock()
	revoked := h.revoked[hash]
	previous, exists := h.responses[hash][message.RequestID]
	h.mu.Unlock()
	if revoked || ctx.Err() != nil {
		conn.Close(websocket.StatusCode(4003), "SESSION_EXPIRED")
		return false
	}
	if message.RequestID != "" && exists {
		return h.queue(conn, previous)
	}
	if h.game != nil && message.Type == "join_world" {
		var payload map[string]any
		if err := json.Unmarshal(message.Payload, &payload); err != nil || payload == nil || len(payload) != 0 {
			return h.replyError(ctx, conn, hash, message.RequestID, "INVALID_MESSAGE", "Неверный запрос")
		}
		if err := h.game.join(ctx, r, u, hash, conn, message.RequestID, h); err != nil {
			code := "INVALID_MESSAGE"
			if err.Error() == "VEHICLE_BUSY" {
				code = "VEHICLE_BUSY"
			}
			if err.Error() == "WORLD_BUDGET_EXCEEDED" {
				code = "WORLD_BUDGET_EXCEEDED"
			}
			return h.replyError(ctx, conn, hash, message.RequestID, code, "Не удалось войти в мир")
		}
		return true
	}
	if h.game != nil && message.Type == "leave_world" {
		var payload map[string]any
		if err := json.Unmarshal(message.Payload, &payload); err != nil || payload == nil || len(payload) != 0 {
			return h.replyError(ctx, conn, hash, message.RequestID, "INVALID_MESSAGE", "Неверный запрос")
		}
		return h.game.leave(ctx, u.ID, conn, message.RequestID, h, hash)
	}
	if h.game != nil && message.Type == "world_loaded" {
		return h.game.worldLoaded(ctx, u.ID, conn, message, h, hash)
	}
	if h.game != nil && message.Type == "world_load_failed" {
		return h.game.worldLoadFailed(ctx, u.ID, conn, message, h, hash)
	}
	if h.game != nil && message.Type == "chat_send" {
		return h.game.chat(ctx, u.ID, conn, message, h, hash)
	}
	if h.game != nil && message.Type == "player_input" {
		return h.game.receiveInput(ctx, u.ID, conn, message)
	}
	code, text := "NOT_IN_WORLD", "Сначала войдите в мир"
	if h.game != nil && h.game.joined(u.ID, conn) {
		code, text = "INVALID_MESSAGE", "Неизвестный тип сообщения"
	}
	return h.replyError(ctx, conn, hash, message.RequestID, code, text)
}
func socketWrite(ctx context.Context, conn *websocket.Conn, message envelope) bool {
	data, err := json.Marshal(message)
	if err != nil {
		return false
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return conn.Write(writeCtx, websocket.MessageText, data) == nil
}

func socketError(ctx context.Context, conn *websocket.Conn, requestID, code, message string) bool {
	payload, err := json.Marshal(map[string]any{"code": code, "message": message, "retryable": false})
	return err == nil && socketWrite(ctx, conn, envelope{Version: 1, Type: "server_error", RequestID: requestID, Payload: payload})
}
