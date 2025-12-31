Feature: dbtool migrate script
  The dbtool migration helper should be safe to run in CI and on developer machines.
  It must fail fast when required environment is missing, use the host architecture
  during matrix builds, and warn when the Go migration entrypoint is absent.

  Scenario: Missing DATABASE_URL aborts before running migrations
    Given DATABASE_URL is not set
    When the dbtool migration script runs
    Then it exits with a non-zero status
    And it prints "DATABASE_URL is not set"

  Scenario: Uses host GOARCH/GOOS when invoking go run
    Given DATABASE_URL is set
    And a stub go binary reports the host GOARCH "native-arch" and GOOS "native-os"
    And the environment sets GOARCH to "arm64" for a matrix build
    When the dbtool migration script runs
    Then it exits successfully
    And the go run invocation receives GOARCH "native-arch" and GOOS "native-os"

  Scenario: Errors when migrate.go is missing
    Given DATABASE_URL is set
    And the backend db/migrate.go file is absent
    When the dbtool migration script runs
    Then it exits with a non-zero status
    And it prints "Migration tool not found at db/migrate.go"
