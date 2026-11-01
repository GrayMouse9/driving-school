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

func SetCurrentLocation(ctx context.Context, db *sql.DB, playerID, locationID string) error {
	_, err := db.ExecContext(ctx, `INSERT INTO location (player_id, location_id) VALUES ($1,$2)
		ON CONFLICT (player_id) DO UPDATE SET
		location_id=EXCLUDED.location_id,
		description=CASE WHEN location.location_id=EXCLUDED.location_id THEN location.description ELSE NULL END,
		correct_answer=CASE WHEN location.location_id=EXCLUDED.location_id THEN location.correct_answer ELSE NULL END`, playerID, locationID)
	return err
}

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
