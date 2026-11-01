package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"driving-school/backend/internal/httpx"
	"driving-school/backend/internal/progress"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgconn"
	"io"
	"net/http"
	"strings"
	"time"
)

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func RegisterRoutes(mux *http.ServeMux, db *sql.DB, closeSession func([32]byte, time.Time)) {
	mux.HandleFunc("POST /api/v1/auth/register", func(w http.ResponseWriter, r *http.Request) {
		var c credentials
		if !decodeCredentials(w, r, &c, 8) {
			return
		}
		passwordHash, err := HashPassword(c.Password)
		if err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		id, err := RandomToken(16)
		if err != nil || db == nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		u := User{ID: id, Username: strings.TrimSpace(c.Username)}
		_, err = db.ExecContext(r.Context(), `INSERT INTO users (id,username,password_hash) VALUES ($1,$2,$3)`, u.ID, u.Username, passwordHash)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "users_username_lower_idx" {
				httpx.WriteError(w, 409, "USERNAME_TAKEN", "Имя уже занято")
				return
			}
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"user": u})
	})
	mux.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var c credentials
		if !decodeCredentials(w, r, &c, 1) {
			return
		}
		if db == nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		var u User
		var passwordHash string
		err := db.QueryRowContext(r.Context(), `SELECT id,username,password_hash FROM users WHERE lower(username)=lower($1)`, strings.TrimSpace(c.Username)).Scan(&u.ID, &u.Username, &passwordHash)
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, 401, "INVALID_CREDENTIALS", "Неверное имя или пароль")
			return
		}
		if err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		if !VerifyPassword(passwordHash, c.Password) {
			httpx.WriteError(w, 401, "INVALID_CREDENTIALS", "Неверное имя или пароль")
			return
		}
		token, err := RandomToken(32)
		if err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		hash := sha256.Sum256([]byte(token))
		expires := time.Now().Add(24 * time.Hour)
		_, err = db.ExecContext(r.Context(), `INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)`, hash[:], u.ID, expires)
		if err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "session", Value: token, Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteLaxMode, Expires: expires})
		httpx.WriteJSON(w, 200, map[string]any{"user": u})
	})
	mux.HandleFunc("POST /api/v1/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("session")
		if err != nil || cookie.Value == "" {
			httpx.WriteError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
			return
		}
		if db == nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		var payload map[string]any
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		if err := decoder.Decode(&payload); err != nil || payload == nil || len(payload) != 0 {
			httpx.WriteError(w, 400, "INVALID_MESSAGE", "Неверные данные")
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			httpx.WriteError(w, 400, "INVALID_MESSAGE", "Неверные данные")
			return
		}
		hash := sha256.Sum256([]byte(cookie.Value))
		var expires time.Time
		err = db.QueryRowContext(r.Context(), `DELETE FROM sessions WHERE token_hash=$1 AND expires_at>now() RETURNING expires_at`, hash[:]).Scan(&expires)
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
			return
		}
		if err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		closeSession(hash, expires)
		http.SetCookie(w, &http.Cookie{Name: "session", Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteLaxMode, MaxAge: -1})
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/v1/profile", func(w http.ResponseWriter, r *http.Request) {
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
		var u User
		err = db.QueryRowContext(r.Context(), `SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, hash[:]).Scan(&u.ID, &u.Username)
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
			return
		}
		if err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		progress, err := progress.Read(r.Context(), db, u.ID)
		if err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		httpx.WriteJSON(w, 200, map[string]any{"user": u, "progress": progress})
	})
}

func AuthenticatedUser(w http.ResponseWriter, r *http.Request, db *sql.DB) (User, bool) {
	var u User
	hash, ok := SessionDigest(r)
	if !ok {
		httpx.WriteError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
		return u, false
	}
	if db == nil {
		httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
		return u, false
	}
	err := db.QueryRowContext(r.Context(), `SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, hash[:]).Scan(&u.ID, &u.Username)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 401, "UNAUTHENTICATED", "Войдите в аккаунт")
		return u, false
	}
	if err != nil {
		httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
		return u, false
	}
	return u, true
}

func decodeCredentials(w http.ResponseWriter, r *http.Request, c *credentials, minimumPasswordLength int) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(c); err != nil {
		httpx.WriteError(w, 400, "INVALID_MESSAGE", "Неверные данные")
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF || !validateCredentials(c.Username, c.Password, minimumPasswordLength) {
		httpx.WriteError(w, 400, "INVALID_MESSAGE", "Неверные данные")
		return false
	}
	return true
}

func RandomToken(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func SessionDigest(r *http.Request) ([32]byte, bool) {
	cookie, err := r.Cookie("session")
	if err != nil || cookie.Value == "" {
		return [32]byte{}, false
	}
	return sha256.Sum256([]byte(cookie.Value)), true
}
