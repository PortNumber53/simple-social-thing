package handlers

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

func TestProcessDueScheduledPostsOnce_EnqueuesJob(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	h := New(db)
	when := time.Now().UTC().Add(-1 * time.Minute)

	rows := sqlmock.NewRows([]string{"id", "userId", "scheduledFor"}).
		AddRow("p1", "u1", when)

	mock.ExpectQuery(`FROM public\."Posts"\s+WHERE status = 'scheduled'`).
		WithArgs(25).
		WillReturnRows(rows)

	mock.ExpectExec(`UPDATE public\."Posts"\s+SET "lastPublishJobId"`).
		WithArgs("p1", "u1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	details := sqlmock.NewRows([]string{"content", "providers", "media", "scheduledFor"}).
		AddRow(sql.NullString{Valid: true, String: "hello"}, pq.StringArray{"facebook"}, pq.StringArray{}, when)
	mock.ExpectQuery(`SELECT content,\s*COALESCE\(providers, ARRAY\[\]::text\[\]\),\s*COALESCE\(media, ARRAY\[\]::text\[\]\)`).
		WithArgs("p1", "u1", sqlmock.AnyArg()).
		WillReturnRows(details)

	mock.ExpectExec(`INSERT INTO public\."PublishJobs"`).
		WithArgs(sqlmock.AnyArg(), "u1", sqlmock.AnyArg(), "hello", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	n, err := h.processDueScheduledPostsOnce(context.Background(), "https://app.test", 25, func(jobID, userID, caption string, providers []string, relMedia []string) {})
	if err != nil {
		t.Fatalf("processDueScheduledPostsOnce err=%v", err)
	}
	if n != 1 {
		t.Fatalf("expected enqueued=1 got %d", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestProcessDueScheduledPostsOnce_EmptyContent_MarksFailed_NoJobInsert(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer func() { _ = db.Close() }()

	h := New(db)
	when := time.Now().UTC().Add(-1 * time.Minute)

	rows := sqlmock.NewRows([]string{"id", "userId", "scheduledFor"}).
		AddRow("p1", "u1", when)

	mock.ExpectQuery(`FROM public\."Posts"\s+WHERE status = 'scheduled'`).
		WithArgs(25).
		WillReturnRows(rows)

	mock.ExpectExec(`UPDATE public\."Posts"\s+SET "lastPublishJobId"`).
		WithArgs("p1", "u1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	details := sqlmock.NewRows([]string{"content", "providers", "media", "scheduledFor"}).
		AddRow(sql.NullString{Valid: true, String: "   "}, pq.StringArray{"facebook"}, pq.StringArray{}, when)
	mock.ExpectQuery(`SELECT content,\s*COALESCE\(providers, ARRAY\[\]::text\[\]\),\s*COALESCE\(media, ARRAY\[\]::text\[\]\)`).
		WithArgs("p1", "u1", sqlmock.AnyArg()).
		WillReturnRows(details)

	mock.ExpectExec(`UPDATE public\."Posts"\s+SET "lastPublishStatus"='failed'`).
		WithArgs("p1", "u1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	n, err := h.processDueScheduledPostsOnce(context.Background(), "https://app.test", 25, func(jobID, userID, caption string, providers []string, relMedia []string) {})
	if err != nil {
		t.Fatalf("processDueScheduledPostsOnce err=%v", err)
	}
	if n != 0 {
		t.Fatalf("expected enqueued=0 got %d", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}
