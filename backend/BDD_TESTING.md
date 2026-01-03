# BDD Testing with Godog

This document describes the Behavior-Driven Development (BDD) testing setup for the Simple Social Thing backend using [Godog](https://github.com/cucumber/godog).

## Overview

BDD tests are written in Gherkin syntax (`.feature` files) and describe the behavior of the API from a user's perspective. This approach:

- **Improves communication** between developers, QA, and stakeholders
- **Documents features** in a human-readable format
- **Validates business requirements** through executable specifications
- **Provides living documentation** that stays in sync with the code

## Project Structure

```
backend/
├── features/                    # Gherkin feature files
│   ├── health.feature          # Health check endpoint
│   ├── users.feature           # User management
│   ├── social_connections.feature
│   ├── teams.feature
│   ├── posts.feature
│   ├── publishing.feature
│   ├── uploads.feature
│   ├── social_library.feature
│   ├── notifications.feature
│   ├── user_settings.feature
│   ├── suno.feature
│   └── realtime.feature
├── bdd_test.go                 # Step definitions and test setup
├── Makefile.bdd                # BDD-specific make targets
└── .env.test.example           # Test environment configuration
```

## Setup

### 1. Install Dependencies

```bash
cd backend
go mod download
```

### 2. Create Test Database

```bash
# Create a separate test database
createdb simple_social_test

# Or using psql
psql -U postgres -c "CREATE DATABASE simple_social_test;"
```

### 3. Configure Test Environment

```bash
# Copy the example test environment file
cp .env.test.example .env.test

# Update with your test database credentials
vim .env.test
```

### 4. Run Migrations on Test Database

```bash
# Set DATABASE_URL to your test database
export DATABASE_URL="postgresql://user:password@localhost:5432/simple_social_test?sslmode=disable"

# Run migrations
go run db/migrate.go -direction=up
```

## Running Tests

### Quick Start
```bash
# 1. Ensure PostgreSQL is running (Docker or local)
# If using Docker:
docker ps | grep postgres  # Verify container is running

# 2. Run BDD tests (includes migrations)
cd backend
./run-bdd-tests.sh
```

### First-Time Setup
```bash
# 1. Create test database (one-time setup)
# Using Docker container:
docker exec <postgres-container> psql -U postgres -c "CREATE DATABASE simple_social_test;"

# Or using local PostgreSQL:
createdb simple_social_test

# 2. Update run-bdd-tests.sh with your database credentials
# Edit the DATABASE_URL in the script if needed

# 3. Run tests
./run-bdd-tests.sh
```

### Run All BDD Tests

**Recommended - Using the helper script (includes migrations):**
```bash
# This script will:
# 1. Drop and recreate the test database schema
# 2. Run all migrations
# 3. Execute BDD tests
./run-bdd-tests.sh
```

**Alternative - Manual execution:**
```bash
# Set DATABASE_URL and run tests
export DATABASE_URL="postgresql://user:pass@localhost:5432/simple_social_test?sslmode=disable"
make -f Makefile.bdd bdd-test

# Or using go test directly
go test -v -run TestFeatures
```

### Run Specific Feature

```bash
# Run only the users feature
make -f Makefile.bdd bdd-test-feature F=users

# Run only the health feature
make -f Makefile.bdd bdd-test-feature F=health
```

### Run with Verbose Output

```bash
make -f Makefile.bdd bdd-test-verbose
```

### Run Tests with Tags

You can tag scenarios in feature files and run specific subsets:

```bash
# Run tests tagged with @wip (work in progress)
make -f Makefile.bdd bdd-test-tags T=@wip

# Run tests excluding @slow scenarios
make -f Makefile.bdd bdd-test-tags T="~@slow"
```

## Writing Feature Files

Feature files use Gherkin syntax. Here's an example:

```gherkin
Feature: User Management
  As a user of the social platform
  I want to manage user accounts
  So that I can create and access user profiles

  Background:
    Given the database is clean
    And the API server is running

  Scenario: Create a new user
    When I send a POST request to "/api/users" with JSON:
      """
      {
        "id": "user123",
        "email": "test@example.com",
        "name": "Test User"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "id" set to "user123"
```

### Gherkin Keywords

- **Feature**: High-level description of a feature
- **Background**: Steps that run before each scenario
- **Scenario**: A specific test case
- **Given**: Preconditions/setup
- **When**: Actions/triggers
- **Then**: Expected outcomes
- **And/But**: Additional steps

## Available Step Definitions

### Database Setup
- `Given the database is clean`
- `Given the API server is running`

### User Setup
- `Given a user exists with id "user123" and email "test@example.com"`
- `Given a team exists with id "team123" and ownerId "owner123"`
- `Given the user "user123" has a "facebook" connection with providerId "fb123"`

### HTTP Requests
- `When I send a GET request to "/api/users/user123"`
- `When I send a POST request to "/api/users" with JSON:`
- `When I send a PUT request to "/api/users/user123" with JSON:`
- `When I send a DELETE request to "/api/posts/post123/user/user123"`

### Response Assertions
- `Then the response status code should be 200`
- `Then the response should contain JSON with "id" set to "user123"`
- `Then the response should contain error "User not found"`
- `Then the response should be a JSON array with 3 items`
- `Then the response should contain a "jobId" field`

### Data Verification
- `Then the user "user123" should have email "updated@example.com"`
- `Then the post "post456" should not exist`
- `Then the notification "notif123" should be marked as read`

## Test Coverage

The BDD test suite covers the following features:

### ✅ Core Features
- **Health Check** - API availability monitoring
- **User Management** - CRUD operations for users
- **Social Connections** - OAuth integration with social platforms
- **Teams** - Team creation and membership

### ✅ Content Management
- **Posts** - Draft, scheduled, and published posts
- **Publishing** - Multi-platform social media publishing
- **Uploads** - Media file management
- **Social Library** - Imported content from social platforms

### ✅ User Features
- **Notifications** - System notifications and alerts
- **User Settings** - Per-user configuration
- **Suno Integration** - AI music generation

### ✅ Real-time Features
- **WebSocket Events** - Live updates for publishing jobs

## Best Practices

### 1. Keep Scenarios Focused
Each scenario should test one specific behavior:

```gherkin
# Good - focused on one thing
Scenario: Create a new user
  When I send a POST request to "/api/users" with JSON:
    """
    {"id": "user123", "email": "test@example.com"}
    """
  Then the response status code should be 200

# Avoid - testing multiple things
Scenario: Create user and post and publish
  # Too much in one scenario
```

### 2. Use Background for Common Setup
```gherkin
Background:
  Given the database is clean
  And the API server is running
  And a user exists with id "user123" and email "test@example.com"
```

### 3. Use Descriptive Scenario Names
```gherkin
# Good
Scenario: Get a non-existent user returns 404

# Avoid
Scenario: Test user endpoint
```

### 4. Use Data Tables for Multiple Values
```gherkin
Scenario: Upload a file
  When I send a POST request to "/api/uploads/user/user123" with a file upload:
    | filename    | test.jpg   |
    | contentType | image/jpeg |
    | size        | 1024       |
```

## Continuous Integration

Add BDD tests to your CI pipeline:

```yaml
# .github/workflows/bdd-tests.yml
name: BDD Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: simple_social_test
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Set up Go
        uses: actions/setup-go@v4
        with:
          go-version: '1.23'

      - name: Run BDD Tests
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/simple_social_test?sslmode=disable
        run: |
          cd backend
          go mod download
          go run db/migrate.go -direction=up
          make -f Makefile.bdd bdd-test
```

## Debugging Tests

### View Detailed Output
```bash
go test -v -run TestFeatures -godog.format=pretty
```

### Run Single Scenario
Add `@focus` tag to a scenario:
```gherkin
@focus
Scenario: Create a new user
  # ...
```

Then run:
```bash
make -f Makefile.bdd bdd-test-tags T=@focus
```

### Check Database State
Add a step to pause execution:
```gherkin
And I pause for debugging
```

Implement in `bdd_test.go`:
```go
ctx.Step(`^I pause for debugging$`, func() error {
    fmt.Println("Paused. Press Enter to continue...")
    fmt.Scanln()
    return nil
})
```

## Extending the Test Suite

### Adding New Step Definitions

Edit `bdd_test.go` and add new step functions:

```go
func (ctx *bddTestContext) theUserHasAPremiumSubscription(userId string) error {
    query := `UPDATE public."Users" SET subscription = 'premium' WHERE id = $1`
    _, err := ctx.db.Exec(query, userId)
    return err
}

// Register in InitializeScenario
ctx.Step(`^the user "([^"]*)" has a premium subscription$`,
    testCtx.theUserHasAPremiumSubscription)
```

### Adding New Features

1. Create a new `.feature` file in `features/`
2. Write scenarios using existing or new step definitions
3. Implement any missing step definitions in `bdd_test.go`
4. Run the tests to verify

## Resources

- [Godog Documentation](https://github.com/cucumber/godog)
- [Gherkin Reference](https://cucumber.io/docs/gherkin/reference/)
- [BDD Best Practices](https://cucumber.io/docs/bdd/)
- [Writing Good Gherkin](https://cucumber.io/docs/bdd/better-gherkin/)

## Troubleshooting

### Database Connection Issues
```bash
# Verify database exists
psql -U postgres -l | grep simple_social_test

# Check connection string
echo $DATABASE_URL
```

### Migration Errors
```bash
# Reset test database
dropdb simple_social_test
createdb simple_social_test
go run db/migrate.go -direction=up
```

### Import Errors
```bash
# Ensure all dependencies are installed
go mod tidy
go mod download
```
