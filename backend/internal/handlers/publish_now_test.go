package handlers

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

func TestPublishScheduledPostNowOnce_EnqueuesJob(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	h := New(db)
	now := time.Now().UTC()

	// Claim + return content/providers/media/scheduledFor
	mock.ExpectQuery(`UPDATE public\.posts`).
		WithArgs("p1", "u1", sqlmock.AnyArg()).
		WillReturnRows(
			sqlmock.NewRows([]string{"content", "providers", "media", "scheduledFor"}).
				AddRow(sql.NullString{Valid: true, String: "hi"}, pq.StringArray{"instagram"}, pq.StringArray{"/media/u/shard/img.png"}, now),
		)

	// Insert job row
	mock.ExpectExec(`INSERT INTO public\.publish_jobs`).
		WithArgs(sqlmock.AnyArg(), "u1", sqlmock.AnyArg(), "hi", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))

	jobID, err := h.publishScheduledPostNowOnce(context.Background(), "https://example.com", "p1", "u1", nil)
	if err != nil {
		t.Fatalf("expected nil err got %v", err)
	}
	if jobID == "" {
		t.Fatalf("expected jobID")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}
