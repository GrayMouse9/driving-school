package realtime

import (
	"context"
	"database/sql"
	"driving-school/backend/internal/auth"
	"driving-school/backend/internal/httpx"
	"driving-school/backend/internal/storage"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

// middleware: разрешает доступ только настроенному владельцу действующей сессии.
func requireAdmin(db *sql.DB, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, ok := auth.AuthenticatedUser(w, r, db)
		if !ok {
			return
		}
		if admin := os.Getenv("ADMIN_USER_ID"); admin == "" || u.ID != admin {
			httpx.WriteError(w, http.StatusForbidden, "FORBIDDEN", "Нет доступа к админке")
			return
		}
		if r.Method != http.MethodGet {
			origin, err := url.Parse(r.Header.Get("Origin"))
			if err != nil || origin.Host != r.Host || (origin.Scheme != "http" && origin.Scheme != "https") {
				httpx.WriteError(w, http.StatusForbidden, "FORBIDDEN", "Неверный источник запроса")
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		next(w, r)
	}
}

// service: проверяет наличие локации и отсутствие других игроков в ней.
func locationAvailable(statuses []storage.LocationStatus, id, playerID string) bool {
	for _, status := range statuses {
		if status.ID != id {
			continue
		}
		for _, occupant := range status.Occupants {
			if occupant.PlayerID != playerID {
				return false
			}
		}
		return true
	}
	return false
}

// service: проверяет занятость и сохраняет назначение без перемещения машины.
func (g *game) SetCurrentLocation(ctx context.Context, playerID, locationID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[playerID]
	if p == nil || p.conn == nil {
		return errors.New("Игрок не подключён")
	}
	statuses := make([]storage.LocationStatus, 0)
	for _, id := range storage.GetAllLocations() {
		status := storage.LocationStatus{ID: id}
		for _, other := range g.players {
			if other.conn != nil && other.locationID == id {
				status.Occupants = append(status.Occupants, storage.LocationOccupant{PlayerID: other.user.ID})
			}
		}
		statuses = append(statuses, status)
	}
	if !locationAvailable(statuses, locationID, playerID) {
		return errors.New("Локация недоступна или занята")
	}
	g.locationMu.Lock()
	defer g.locationMu.Unlock()
	if err := storage.SetCurrentLocation(ctx, g.db, playerID, locationID); err != nil {
		return errors.New("Не удалось сохранить локацию")
	}
	delete(g.locations, playerID)
	p.locationID = locationID
	p.manualLocation = true
	return nil
}

// handler: подключает защищённые административные операции.
func registerAdminRoutes(mux *http.ServeMux, db *sql.DB, g *game) {
	mux.HandleFunc("GET /api/v1/admin/state", requireAdmin(db, func(w http.ResponseWriter, r *http.Request) {
		if g == nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Игровой мир недоступен")
			return
		}
		g.adminState(w, r)
	}))
	mux.HandleFunc("POST /api/v1/admin/players/{playerId}/location", requireAdmin(db, func(w http.ResponseWriter, r *http.Request) {
		if g == nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Игровой мир недоступен")
			return
		}
		g.adminSetLocation(w, r)
	}))
	mux.HandleFunc("GET /api/v1/admin/prompt", requireAdmin(db, func(w http.ResponseWriter, r *http.Request) {
		prompt, err := readSystemPrompt()
		if err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Файл промпта не настроен или недоступен")
			return
		}
		httpx.WriteJSON(w, 200, map[string]string{"prompt": prompt, "defaultPrompt": defaultSystemPrompt})
	}))
	mux.HandleFunc("POST /api/v1/admin/prompt", requireAdmin(db, func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Prompt string `json:"prompt"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil || len(request.Prompt) > 65536 || len(strings.TrimSpace(request.Prompt)) == 0 {
			httpx.WriteError(w, 400, "INVALID_MESSAGE", "Введите непустой промпт до 65536 байт")
			return
		}
		if err := writeSystemPrompt(request.Prompt); err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Не удалось сохранить промпт")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}

type adminPlayer struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	LocationID  string    `json:"locationId"`
	Position    vec3      `json:"position"`
	ConnectedAt time.Time `json:"connectedAt"`
	FPS         *int      `json:"fps"`
	Ping        *int      `json:"ping"`
}

// service: формирует снимок подключённых игроков и занятости известных локаций.
func (g *game) adminSnapshot() ([]adminPlayer, []storage.LocationStatus) {
	g.mu.Lock()
	defer g.mu.Unlock()
	players := []adminPlayer{}
	statuses := make([]storage.LocationStatus, 0)
	for _, id := range storage.GetAllLocations() {
		statuses = append(statuses, storage.LocationStatus{ID: id, Occupants: []storage.LocationOccupant{}})
	}
	for _, p := range g.players {
		if p.conn == nil {
			continue
		}
		item := adminPlayer{ID: p.user.ID, Username: p.user.Username, LocationID: p.locationID, Position: vec3{X: p.car.X, Y: p.y, Z: p.car.Z}, ConnectedAt: p.connectedAt}
		if !p.telemetryAt.IsZero() && time.Since(p.telemetryAt) <= 30*time.Second {
			fps, ping := p.telemetry.FPS, p.telemetry.Ping
			item.FPS, item.Ping = &fps, &ping
		}
		players = append(players, item)
		for i := range statuses {
			if statuses[i].ID == p.locationID {
				statuses[i].Occupants = append(statuses[i].Occupants, storage.LocationOccupant{PlayerID: p.user.ID, Username: p.user.Username})
			}
		}
	}
	sort.Slice(players, func(i, j int) bool {
		if players[i].ConnectedAt.Equal(players[j].ConnectedAt) {
			return players[i].ID < players[j].ID
		}
		return players[i].ConnectedAt.Before(players[j].ConnectedAt)
	})
	return players, statuses
}

// handler: отдаёт карту и снимок игровых данных администратору.
func (g *game) adminState(w http.ResponseWriter, r *http.Request) {
	players, statuses := g.adminSnapshot()
	type mapChunk struct {
		X     float64         `json:"x"`
		Z     float64         `json:"z"`
		Size  float64         `json:"size"`
		Roads json.RawMessage `json:"roads"`
	}
	chunks := make([]mapChunk, 0, len(g.w.Chunks))
	for _, c := range g.w.Chunks {
		var data struct {
			Roads json.RawMessage `json:"roads"`
		}
		if err := json.Unmarshal(c.Data, &data); err != nil {
			httpx.WriteError(w, 503, "SERVICE_UNAVAILABLE", "Не удалось загрузить карту")
			return
		}
		chunks = append(chunks, mapChunk{X: c.X, Z: c.Z, Size: c.Size, Roads: data.Roads})
	}
	httpx.WriteJSON(w, 200, map[string]any{"players": players, "locations": statuses, "chunks": chunks})
}

// handler: проверяет запрос на назначение локации.
func (g *game) adminSetLocation(w http.ResponseWriter, r *http.Request) {
	var request struct {
		LocationID string `json:"locationId"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if err := d.Decode(&request); err != nil || request.LocationID == "" {
		httpx.WriteError(w, 400, "INVALID_MESSAGE", "Укажите локацию")
		return
	}
	if err := g.SetCurrentLocation(r.Context(), r.PathValue("playerId"), request.LocationID); err != nil {
		httpx.WriteError(w, 409, "LOCATION_UNAVAILABLE", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
