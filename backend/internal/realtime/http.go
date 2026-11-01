package realtime

import (
	"database/sql"
	"driving-school/backend/internal/auth"
	"driving-school/backend/internal/httpx"
	"driving-school/backend/internal/lobby"
	"driving-school/backend/internal/progress"
	"net/http"
)

type user = auth.User

func NewHandler(db *sql.DB) http.Handler {
	return newHandler(db, newSocketHub())
}

func newHandler(db *sql.DB, hub *socketHub) http.Handler {
	mux := http.NewServeMux()
	registerAdminRoutes(mux, db, hub.game)
	mux.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) { hub.serve(db, w, r) })
	if hub.game != nil {
		mux.HandleFunc("GET /api/v1/world/manifest", hub.game.serveWorldMeta)
		mux.HandleFunc("GET /api/v1/world/chunks/{chunkId}", hub.game.serveChunk)
		mux.HandleFunc("GET /api/v1/world/assets/{assetId}", hub.game.serveAsset)
		mux.HandleFunc("GET /api/v1/game/session", func(w http.ResponseWriter, r *http.Request) {
			if _, ok := auth.AuthenticatedUser(w, r, db); !ok {
				return
			}
			hub.game.mu.Lock()
			online := 0
			for _, p := range hub.game.players {
				if p.conn != nil {
					online++
				}
			}
			capacity := len(hub.game.w.Spawns)
			hub.game.mu.Unlock()
			httpx.WriteJSON(w, 200, lobby.Session{ID: "main", PlayersOnline: online, MaxPlayers: capacity})
		})
	}
	mux.HandleFunc("GET /api/v1/progress", func(w http.ResponseWriter, r *http.Request) {
		u, ok := auth.AuthenticatedUser(w, r, db)
		if !ok {
			return
		}
		p, err := progress.Read(r.Context(), db, u.ID)
		if err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Сервис недоступен")
			return
		}
		httpx.WriteJSON(w, 200, map[string]any{"progress": p})
	})
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		if db == nil || db.PingContext(r.Context()) != nil {
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded"})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	auth.RegisterRoutes(mux, db, hub.closeSession)
	return mux
}
