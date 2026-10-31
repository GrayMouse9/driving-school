package storage

import (
	"context"
	"database/sql"
)

func LoadPosition(ctx context.Context, db *sql.DB, userID string, x, y, z, yaw *float64) error {
	return db.QueryRowContext(ctx, `SELECT x,y,z,yaw FROM player_state WHERE user_id=$1`, userID).Scan(x, y, z, yaw)
}
func SavePosition(ctx context.Context, db *sql.DB, userID string, x, y, z, yaw float64) error {
	_, err := db.ExecContext(ctx, `INSERT INTO player_state (user_id,x,y,z,yaw) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO UPDATE SET x=EXCLUDED.x,y=EXCLUDED.y,z=EXCLUDED.z,yaw=EXCLUDED.yaw`, userID, x, y, z, yaw)
	return err
}
