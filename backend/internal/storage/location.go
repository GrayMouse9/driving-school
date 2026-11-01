package storage

import (
	"context"
	"database/sql"
	"errors"
)

type Location struct {
	PlayerID      string
	LocationID    string
	Description   sql.NullString
	CorrectAnswer sql.NullString
}

type LocationOccupant struct {
	PlayerID string `json:"playerId"`
	Username string `json:"username"`
}

type LocationStatus struct {
	ID        string             `json:"id"`
	Occupants []LocationOccupant `json:"occupants"`
}

// repo: список учебных локаций пока не настроен.
func GetAllLocations() []string {
	return []string{}
}

// repo: возвращает назначенных игроков для известных локаций, включая нескольких игроков.
func GetAllLocationsStatuses(ctx context.Context, db *sql.DB) ([]LocationStatus, error) {
	rows, err := db.QueryContext(ctx, `SELECT l.location_id, u.id, u.username FROM location l JOIN users u ON u.id=l.player_id ORDER BY u.username, u.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	occupants := make(map[string][]LocationOccupant)
	for rows.Next() {
		var id string
		var occupant LocationOccupant
		if err := rows.Scan(&id, &occupant.PlayerID, &occupant.Username); err != nil {
			return nil, err
		}
		occupants[id] = append(occupants[id], occupant)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	statuses := make([]LocationStatus, 0, len(GetAllLocations()))
	for _, id := range GetAllLocations() {
		players := occupants[id]
		if players == nil {
			players = []LocationOccupant{}
		}
		statuses = append(statuses, LocationStatus{ID: id, Occupants: players})
	}
	return statuses, nil
}

// repo: сохраняет назначенную игроку локацию.
func SetCurrentLocation(ctx context.Context, db *sql.DB, playerID, locationID string) error {
	_, err := db.ExecContext(ctx, `INSERT INTO location (player_id, location_id) VALUES ($1,$2)
		ON CONFLICT (player_id) DO UPDATE SET
		location_id=EXCLUDED.location_id,
		description=CASE WHEN location.location_id=EXCLUDED.location_id THEN location.description ELSE NULL END,
		correct_answer=CASE WHEN location.location_id=EXCLUDED.location_id THEN location.correct_answer ELSE NULL END`, playerID, locationID)
	return err
}

// repo: читает последнюю сохранённую локацию игрока.
func GetCurrentLocation(ctx context.Context, db *sql.DB, playerID string) (Location, bool, error) {
	var location Location
	err := db.QueryRowContext(ctx, `SELECT player_id, location_id, description, correct_answer FROM location WHERE player_id=$1`, playerID).
		Scan(&location.PlayerID, &location.LocationID, &location.Description, &location.CorrectAnswer)
	if errors.Is(err, sql.ErrNoRows) {
		return Location{}, false, nil
	}
	if err != nil {
		return Location{}, false, err
	}
	return location, true, nil
}
