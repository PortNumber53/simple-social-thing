# Simple Social Thing - Backend

Go backend API for Simple Social Thing application.

## Features

- RESTful API built with Go
- PostgreSQL database with migrations
- Hot reload development with Air
- Multi-environment deployment with Jenkins
- Systemd service management

## Development

### Prerequisites

- Go 1.23+
- PostgreSQL
- Air (for hot reload)

### Setup

1. Install dependencies:
```bash
cd backend
go mod download
```

2. Install Air for hot reload:
```bash
go install github.com/air-verse/air@latest
```

3. Create `.env` file:
```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
PORT=18911
```

4. Run migrations:
```bash
go run db/migrate.go -direction=up
```

5. Start development server with hot reload:
```bash
air
```

The API will be available at `http://localhost:18911`

## API Endpoints

### Health
- `GET /health` - Health check

### Users
- `POST /api/users` - Create/update user
- `GET /api/users/{id}` - Get user by ID
- `PUT /api/users/{id}` - Update user

### Social Connections
- `POST /api/social-connections` - Create social connection
- `GET /api/social-connections/user/{userId}` - Get user's social connections

### Teams
- `POST /api/teams` - Create team
- `GET /api/teams/{id}` - Get team by ID
- `GET /api/teams/user/{userId}` - Get user's teams

## Database Migrations

### Run migrations
```bash
# Apply all pending migrations
go run db/migrate.go -direction=up

# Rollback all migrations
go run db/migrate.go -direction=down

# Apply specific number of migrations
go run db/migrate.go -direction=up -steps=1

# If you see: "Dirty database version X. Fix and force version."
# (e.g., after an interrupted migration), the safest recovery is usually:
# 1) Force to the previous version (X-1) to clear the dirty flag
# 2) Re-run migrations (so X is applied again)
#
# Example for X=12:
# go run db/migrate.go -force=11
# go run db/migrate.go -direction=up
#
# (Advanced) If you know X fully applied and only the dirty flag is wrong:
# go run db/migrate.go -force=X
```

### Create new migration
```bash
# Create migration files in db/migrations/
# Format: XXX_description.up.sql and XXX_description.down.sql
```

## Deployment

### Jenkins Multi-Configuration

The project uses Jenkins for multi-environment deployment:

- **DEV**: Development environment (port 18911)
- **STAGING**: Staging environment (port 18911)
- **PRODUCTION**: Production environment (port 18911)

### Manual Deployment

1. Build:
```bash
cd backend
CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o bin/api ./cmd/api
```

2. Deploy to environment:
```bash
# Deploy to dev
./deploy/deploy-dev.sh

# Deploy to staging
./deploy/deploy-staging.sh

# Deploy to production
./deploy/deploy-production.sh
```

### Systemd Services

Service files are located in `deploy/systemd/`:

```bash
# Install service
sudo cp deploy/systemd/simple-social-thing-dev.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable simple-social-thing-dev
sudo systemctl start simple-social-thing-dev

# Check status
sudo systemctl status simple-social-thing-dev

# View logs
sudo journalctl -u simple-social-thing-dev -f
```

## Project Structure

```
backend/
├── cmd/
│   └── api/
│       └── main.go           # Application entry point
├── internal/
│   ├── handlers/
│   │   └── handlers.go       # HTTP handlers
│   ├── models/
│   │   └── models.go         # Data models
│   └── db/
│       └── db.go             # Database utilities
├── db/
│   ├── migrations/           # SQL migrations
│   │   ├── 001_initial_schema.up.sql
│   │   └── 001_initial_schema.down.sql
│   └── migrate.go            # Migration tool
├── .air.toml                 # Air configuration
├── go.mod                    # Go dependencies
└── README.md
```

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (required)
- `PORT` - Server port (default: 18911)
- `ENVIRONMENT` - Environment name (dev/staging/production)

## Testing

```bash
cd backend
go test ./... -v
```
