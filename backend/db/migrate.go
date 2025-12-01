package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/golang-migrate/migrate/v4"
	migratedb "github.com/golang-migrate/migrate/v4/database"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/joho/godotenv"
	_ "github.com/lib/pq"
)

func main() {
	msg, err := run(os.Args[1:], defaultDeps())
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(msg)
}

type deps struct {
	loadEnv  func(...string) error
	getenv   func(string) string
	openDB   func(driverName, dataSourceName string) (*sql.DB, error)
	migrateF func(db *sql.DB, direction string, steps int) error
}

func defaultDeps() deps {
	return deps{
		loadEnv:  godotenv.Load,
		getenv:   os.Getenv,
		openDB:   sql.Open,
		migrateF: performMigrations,
	}
}

type options struct {
	direction  string
	steps      int
	force      int
	forceDirty bool
}

type migrator interface {
	Up() error
	Down() error
	Steps(n int) error
	Force(version int) error
	Version() (version uint, dirty bool, err error)
}

// These factories are overridden in tests to avoid requiring a real Postgres database connection.
var withPostgresInstance = func(db *sql.DB) (migratedb.Driver, error) {
	return postgres.WithInstance(db, &postgres.Config{})
}

var newMigrateWithDB = func(sourceURL string, databaseName string, driver migratedb.Driver) (migrator, error) {
	return migrate.NewWithDatabaseInstance(sourceURL, databaseName, driver)
}

var newMigrator = func(db *sql.DB) (migrator, error) {
	driver, err := withPostgresInstance(db)
	if err != nil {
		return nil, fmt.Errorf("Failed to create migration driver: %w", err)
	}
	m, err := newMigrateWithDB("file://db/migrations", "postgres", driver)
	if err != nil {
		return nil, fmt.Errorf("Failed to create migrate instance: %w", err)
	}
	return m, nil
}

func parseArgs(args []string) (options, error) {
	fs := flag.NewFlagSet("migrate", flag.ContinueOnError)
	var o options
	fs.StringVar(&o.direction, "direction", "up", "Migration direction: up or down")
	fs.IntVar(&o.steps, "steps", 0, "Number of migration steps (0 = all)")
	fs.IntVar(&o.force, "force", -1, "Force set migration version (clears dirty state). Example: -force=12")
	fs.BoolVar(&o.forceDirty, "force-dirty", false, "If the database is dirty, force it to the current version and exit")
	if err := fs.Parse(args); err != nil {
		return options{}, err
	}
	switch o.direction {
	case "up", "down":
		return o, nil
	default:
		return options{}, fmt.Errorf("Invalid direction: %s (must be 'up' or 'down')", o.direction)
	}
}

func run(args []string, d deps) (string, error) {
	o, err := parseArgs(args)
	if err != nil {
		return "", err
	}

	if d.loadEnv != nil {
		_ = d.loadEnv()
	}

	databaseURL := ""
	if d.getenv != nil {
		databaseURL = d.getenv("DATABASE_URL")
	}
	if databaseURL == "" {
		return "", fmt.Errorf("DATABASE_URL environment variable is required")
	}

	if d.openDB == nil {
		return "", fmt.Errorf("openDB dependency is required")
	}
	db, err := d.openDB("postgres", databaseURL)
	if err != nil {
		return "", fmt.Errorf("Failed to connect to database: %w", err)
	}
	defer db.Close()

	// If requested, forcibly clear dirty state / set version and exit.
	if o.force >= 0 || o.forceDirty {
		m, err := newMigrator(db)
		if err != nil {
			return "", err
		}
		if o.forceDirty {
			v, dirty, verr := m.Version()
			if verr != nil {
				return "", fmt.Errorf("Failed to read migration version: %w", verr)
			}
			if !dirty {
				return "Database is not dirty (no force needed)", nil
			}
			if err := m.Force(int(v)); err != nil {
				return "", fmt.Errorf("Failed to force dirty version %d: %w", v, err)
			}
			return fmt.Sprintf("Forced dirty database to version %d", v), nil
		}
		if err := m.Force(o.force); err != nil {
			return "", fmt.Errorf("Failed to force version %d: %w", o.force, err)
		}
		return fmt.Sprintf("Forced database to version %d", o.force), nil
	}

	if d.migrateF == nil {
		return "", fmt.Errorf("migrateF dependency is required")
	}
	err = d.migrateF(db, o.direction, o.steps)
	if err != nil && err != migrate.ErrNoChange {
		return "", fmt.Errorf("Migration failed: %w", err)
	}

	if err == migrate.ErrNoChange {
		return "No migrations to apply", nil
	}
	return fmt.Sprintf("Migration %s completed successfully", o.direction), nil
}

func performMigrations(db *sql.DB, direction string, steps int) error {
	m, err := newMigrator(db)
	if err != nil {
		return err
	}
	return applyDirection(m, direction, steps)
}

func applyDirection(m migrator, direction string, steps int) error {
	switch direction {
	case "up":
		if steps > 0 {
			return m.Steps(steps)
		}
		return m.Up()
	case "down":
		if steps > 0 {
			return m.Steps(-steps)
		}
		return m.Down()
	default:
		return fmt.Errorf("Invalid direction: %s (must be 'up' or 'down')", direction)
	}
}
