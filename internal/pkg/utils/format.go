package utils

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func ConvertToPgTimestamp(t *time.Time) pgtype.Timestamp {
	if t == nil {
		return pgtype.Timestamp{Valid: false}
	}
	return pgtype.Timestamp{Time: *t, Valid: true}
}
