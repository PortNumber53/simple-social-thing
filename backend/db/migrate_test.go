package main

import (
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-migrate/migrate/v4"
	migratedb "github.com/golang-migrate/migrate/v4/database"
)

func TestParseArgs_Defaults(t *testing.T) {
	o, err := parseArgs(nil)
	if err != nil {
		t.Fatalf("parseArgs: %v", err)
	}
	if o.direction != "up" {
		t.Fatalf("expected direction up, got %q", o.direction)
	}
	if o.steps != 0 {
		t.Fatalf("expected steps 0, got %d", o.steps)
	}
	if o.force != -1 {
		t.Fatalf("expected force -1, got %d", o.force)
	}
	if o.forceDirty {
		t.Fatalf("expected forceDirty false")
	}
}

func TestParseArgs_InvalidDirection(t *testing.T) {
	_, err := parseArgs([]string{"-direction", "sideways"})
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestParseArgs_Force(t *testing.T) {
	o, err := parseArgs([]string{"-force", "12"})
	if err != nil {
		t.Fatalf("parseArgs: %v", err)
	}
	if o.force != 12 {
		t.Fatalf("expected force 12, got %d", o.force)
	}
}

func TestRun_MissingDatabaseURL(t *testing.T) {
	_, err := run(nil, deps{
		loadEnv: func(...string) error { return nil },
		getenv:  func(string) string { return "" },
		openDB: func(string, string) (*sql.DB, error) {
			t.Fatalf("openDB should not be called")
			return nil, nil
		},
		migrateF: func(*sql.DB, string, int) error {
			t.Fatalf("migrateF should not be called")
			return nil
		},
	})
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestRun_NoChange(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	var gotDir string
	var gotSteps int

	msg, err := run([]string{"-direction", "up"}, deps{
		loadEnv: func(...string) error { return nil },
		getenv: func(k string) string {
			if k == "DATABASE_URL" {
				return "postgres://example"
			}
			return ""
		},
		openDB: func(string, string) (*sql.DB, error) { return db, nil },
		migrateF: func(_ *sql.DB, direction string, steps int) error {
			gotDir = direction
			gotSteps = steps
			return migrate.ErrNoChange
		},
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if gotDir != "up" || gotSteps != 0 {
		t.Fatalf("expected migrateF called with up/0, got %q/%d", gotDir, gotSteps)
	}
	if msg != "No migrations to apply" {
		t.Fatalf("expected no-change msg, got %q", msg)
	}
}

func TestRun_StepsDown(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	var gotDir string
	var gotSteps int

	msg, err := run([]string{"-direction", "down", "-steps", "2"}, deps{
		loadEnv: func(...string) error { return nil },
		getenv: func(k string) string {
			if k == "DATABASE_URL" {
				return "postgres://example"
			}
			return ""
		},
		openDB: func(string, string) (*sql.DB, error) { return db, nil },
		migrateF: func(_ *sql.DB, direction string, steps int) error {
			gotDir = direction
			gotSteps = steps
			return nil
		},
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if gotDir != "down" || gotSteps != 2 {
		t.Fatalf("expected migrateF called with down/2, got %q/%d", gotDir, gotSteps)
	}
	if msg != "Migration down completed successfully" {
		t.Fatalf("unexpected msg: %q", msg)
	}
}

func TestRun_OpenDBError(t *testing.T) {
	_, err := run([]string{"-direction", "up"}, deps{
		loadEnv: func(...string) error { return nil },
		getenv: func(k string) string {
			if k == "DATABASE_URL" {
				return "postgres://example"
			}
			return ""
		},
		openDB: func(string, string) (*sql.DB, error) { return nil, sql.ErrConnDone },
		migrateF: func(*sql.DB, string, int) error {
			t.Fatalf("migrateF should not be called")
			return nil
		},
	})
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestRun_MigrateFnMissing(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	_, err = run([]string{"-direction", "up"}, deps{
		loadEnv: func(...string) error { return nil },
		getenv: func(k string) string {
			if k == "DATABASE_URL" {
				return "postgres://example"
			}
			return ""
		},
		openDB:   func(string, string) (*sql.DB, error) { return db, nil },
		migrateF: nil,
	})
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestRun_MigrateError(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	_, err = run([]string{"-direction", "up"}, deps{
		loadEnv: func(...string) error { return nil },
		getenv: func(k string) string {
			if k == "DATABASE_URL" {
				return "postgres://example"
			}
			return ""
		},
		openDB: func(string, string) (*sql.DB, error) { return db, nil },
		migrateF: func(*sql.DB, string, int) error {
			return sql.ErrTxDone
		},
	})
	if err == nil {
		t.Fatalf("expected error")
	}
}

type fakeMigrator struct {
	upCalls    int
	downCalls  int
	stepsCalls []int
	forceCalls []int
	version    uint
	dirty      bool
	versionErr error
}

func (f *fakeMigrator) Up() error                    { f.upCalls++; return nil }
func (f *fakeMigrator) Down() error                  { f.downCalls++; return nil }
func (f *fakeMigrator) Steps(n int) error            { f.stepsCalls = append(f.stepsCalls, n); return nil }
func (f *fakeMigrator) Force(v int) error            { f.forceCalls = append(f.forceCalls, v); return nil }
func (f *fakeMigrator) Version() (uint, bool, error) { return f.version, f.dirty, f.versionErr }

func TestPerformMigrations_UsesNewMigratorAndAppliesDirection(t *testing.T) {
	prevNew := newMigrator
	prevWith := withPostgresInstance
	prevNewMigrate := newMigrateWithDB
	defer func() {
		newMigrator = prevNew
		withPostgresInstance = prevWith
		newMigrateWithDB = prevNewMigrate
	}()

	fm := &fakeMigrator{}
	withPostgresInstance = func(_ *sql.DB) (migratedb.Driver, error) { return nil, nil }
	newMigrateWithDB = func(string, string, migratedb.Driver) (migrator, error) { return fm, nil }

	if err := performMigrations(nil, "up", 0); err != nil {
		t.Fatalf("performMigrations: %v", err)
	}
	if fm.upCalls != 1 {
		t.Fatalf("expected Up called once, got %d", fm.upCalls)
	}
}

func TestRun_ForceVersion_UsesMigratorForceAndExits(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	prevNew := newMigrator
	prevWith := withPostgresInstance
	prevNewMigrate := newMigrateWithDB
	defer func() {
		newMigrator = prevNew
		withPostgresInstance = prevWith
		newMigrateWithDB = prevNewMigrate
	}()

	fm := &fakeMigrator{}
	withPostgresInstance = func(_ *sql.DB) (migratedb.Driver, error) { return nil, nil }
	newMigrateWithDB = func(string, string, migratedb.Driver) (migrator, error) { return fm, nil }

	msg, err := run([]string{"-force", "12"}, deps{
		loadEnv: func(...string) error { return nil },
		getenv: func(k string) string {
			if k == "DATABASE_URL" {
				return "postgres://example"
			}
			return ""
		},
		openDB: func(string, string) (*sql.DB, error) { return db, nil },
		migrateF: func(*sql.DB, string, int) error {
			t.Fatalf("migrateF should not be called when forcing")
			return nil
		},
	})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if msg != "Forced database to version 12" {
		t.Fatalf("unexpected msg: %q", msg)
	}
	if len(fm.forceCalls) != 1 || fm.forceCalls[0] != 12 {
		t.Fatalf("expected Force(12) called, got %#v", fm.forceCalls)
	}
}

func TestApplyDirection_InvalidDirection(t *testing.T) {
	fm := &fakeMigrator{}
	if err := applyDirection(fm, "sideways", 0); err == nil {
		t.Fatalf("expected error")
	}
}

func TestApplyDirection_DownAndSteps(t *testing.T) {
	fm := &fakeMigrator{}
	if err := applyDirection(fm, "down", 0); err != nil {
		t.Fatalf("down: %v", err)
	}
	if fm.downCalls != 1 {
		t.Fatalf("expected Down called, got %d", fm.downCalls)
	}

	fm2 := &fakeMigrator{}
	if err := applyDirection(fm2, "up", 2); err != nil {
		t.Fatalf("up steps: %v", err)
	}
	if len(fm2.stepsCalls) != 1 || fm2.stepsCalls[0] != 2 {
		t.Fatalf("expected Steps(2), got %#v", fm2.stepsCalls)
	}

	fm3 := &fakeMigrator{}
	if err := applyDirection(fm3, "down", 3); err != nil {
		t.Fatalf("down steps: %v", err)
	}
	if len(fm3.stepsCalls) != 1 || fm3.stepsCalls[0] != -3 {
		t.Fatalf("expected Steps(-3), got %#v", fm3.stepsCalls)
	}
}

func TestPerformMigrations_NewMigratorError(t *testing.T) {
	prevWith := withPostgresInstance
	defer func() { withPostgresInstance = prevWith }()

	withPostgresInstance = func(_ *sql.DB) (migratedb.Driver, error) { return nil, sql.ErrConnDone }
	if err := performMigrations(nil, "up", 0); err == nil {
		t.Fatalf("expected error")
	}
}

func TestNewMigrator_FactoryErrorPaths(t *testing.T) {
	prevWith := withPostgresInstance
	prevNewMigrate := newMigrateWithDB
	defer func() {
		withPostgresInstance = prevWith
		newMigrateWithDB = prevNewMigrate
	}()

	withPostgresInstance = func(_ *sql.DB) (migratedb.Driver, error) { return nil, sql.ErrConnDone }
	if _, err := newMigrator(nil); err == nil {
		t.Fatalf("expected error")
	}

	withPostgresInstance = func(_ *sql.DB) (migratedb.Driver, error) { return nil, nil }
	newMigrateWithDB = func(string, string, migratedb.Driver) (migrator, error) { return nil, sql.ErrConnDone }
	if _, err := newMigrator(nil); err == nil {
		t.Fatalf("expected error")
	}
}

func TestDefaultDeps_NonNil(t *testing.T) {
	d := defaultDeps()
	if d.getenv == nil || d.openDB == nil || d.migrateF == nil {
		t.Fatalf("expected default deps to be populated: %#v", d)
	}
}
