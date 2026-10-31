package server

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type user struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func NewHandler(db *sql.DB) http.Handler {
	return newHandler(db, newSocketHub())
}

func newHandler(db *sql.DB, hub *socketHub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) { hub.serve(db, w, r) })
	if hub.game != nil {
		mux.HandleFunc("GET /api/v1/world/manifest", hub.game.serveWorldMeta)
		mux.HandleFunc("GET /api/v1/world/chunks/{chunkId}", hub.game.serveChunk)
		mux.HandleFunc("GET /api/v1/world/assets/{assetId}", hub.game.serveAsset)
		mux.HandleFunc("GET /api/v1/game/session", func(w http.ResponseWriter, r *http.Request) {
			if _, ok := authenticatedUser(w, r, db); !ok {
				return
			}
			hub.game.mu.Lock()
			online := 0
			for _, p := range hub.game.players {
				if p.conn != nil {
					online++
				}
			}
			capacity := len(hub.game.w.spawns)
			hub.game.mu.Unlock()
			writeJSON(w, 200, map[string]any{"id": "main", "playersOnline": online, "maxPlayers": capacity})
		})
	}
	mux.HandleFunc("GET /api/v1/progress", func(w http.ResponseWriter, r *http.Request) {
		u, ok := authenticatedUser(w, r, db)
		if !ok {
			return
		}
		p, err := readProgress(r, db, u.ID)
		if err != nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		writeJSON(w, 200, map[string]any{"progress": p})
	})
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		if db == nil || db.PingContext(r.Context()) != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/v1/auth/register", func(w http.ResponseWriter, r *http.Request) {
		var c credentials
		if !decodeCredentials(w, r, &c) {
			return
		}
		passwordHash, err := hashPassword(c.Password)
		if err != nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		id, err := randomToken(16)
		if err != nil || db == nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		u := user{ID: id, Username: strings.TrimSpace(c.Username)}
		_, err = db.ExecContext(r.Context(), `INSERT INTO users (id,username,password_hash) VALUES ($1,$2,$3)`, u.ID, u.Username, passwordHash)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "users_username_lower_idx" {
				writeError(w, 409, "USERNAME_TAKEN", "Имя уже занято")
				return
			}
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"user": u})
	})
	mux.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var c credentials
		if !decodeCredentials(w, r, &c) {
			return
		}
		if db == nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		var u user
		var passwordHash string
		err := db.QueryRowContext(r.Context(), `SELECT id,username,password_hash FROM users WHERE lower(username)=lower($1)`, strings.TrimSpace(c.Username)).Scan(&u.ID, &u.Username, &passwordHash)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 401, "INVALID_CREDENTIALS", "Неверное имя или пароль")
			return
		}
		if err != nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		if !verifyPassword(passwordHash, c.Password) {
			writeError(w, 401, "INVALID_CREDENTIALS", "Неверное имя или пароль")
			return
		}
		token, err := randomToken(32)
		if err != nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		hash := sha256.Sum256([]byte(token))
		expires := time.Now().Add(24 * time.Hour)
		_, err = db.ExecContext(r.Context(), `INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)`, hash[:], u.ID, expires)
		if err != nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "session", Value: token, Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteLaxMode, Expires: expires})
		writeJSON(w, 200, map[string]any{"user": u})
	})
	mux.HandleFunc("POST /api/v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("session")
		if err != nil || cookie.Value == "" {
			writeError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
			return
		}
		if db == nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		var payload map[string]any
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		if err := decoder.Decode(&payload); err != nil || payload == nil || len(payload) != 0 {
			writeError(w, 400, "INVALID_MESSAGE", "Неверные данные")
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			writeError(w, 400, "INVALID_MESSAGE", "Неверные данные")
			return
		}
		hash := sha256.Sum256([]byte(cookie.Value))
		var expires time.Time
		err = db.QueryRowContext(r.Context(), `DELETE FROM sessions WHERE token_hash=$1 AND expires_at>now() RETURNING expires_at`, hash[:]).Scan(&expires)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
			return
		}
		if err != nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		hub.closeSession(hash, expires)
		http.SetCookie(w, &http.Cookie{Name: "session", Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteLaxMode, MaxAge: -1})
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/v1/profile", func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("session")
		if err != nil || cookie.Value == "" {
			writeError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
			return
		}
		if db == nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		hash := sha256.Sum256([]byte(cookie.Value))
		var u user
		err = db.QueryRowContext(r.Context(), `SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, hash[:]).Scan(&u.ID, &u.Username)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
			return
		}
		if err != nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		progress, err := readProgress(r, db, u.ID)
		if err != nil {
			writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		writeJSON(w, 200, map[string]any{"user": u, "progress": progress})
	})
	return mux
}

func authenticatedUser(w http.ResponseWriter, r *http.Request, db *sql.DB) (user, bool) {
	var u user
	hash, ok := sessionDigest(r)
	if !ok {
		writeError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
		return u, false
	}
	if db == nil {
		writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
		return u, false
	}
	err := db.QueryRowContext(r.Context(), `SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, hash[:]).Scan(&u.ID, &u.Username)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
		return u, false
	}
	if err != nil {
		writeError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
		return u, false
	}
	return u, true
}

func decodeCredentials(w http.ResponseWriter, r *http.Request, c *credentials) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(c); err != nil {
		writeError(w, 400, "INVALID_MESSAGE", "Неверные данные")
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF || !validateCredentials(c.Username, c.Password) {
		writeError(w, 400, "INVALID_MESSAGE", "Неверные данные")
		return false
	}
	return true
}

func randomToken(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("HTTP response encoding failed: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
