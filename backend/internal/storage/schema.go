package storage

import (
	"context"
	"database/sql"
	"driving-school/backend/migrations"
)

func InitSchema(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, migrations.Initial)
	return err
}
