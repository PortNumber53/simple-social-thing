.PHONY: help dev build test migrate-up migrate-down clean

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Run development server with hot reload
	air

build: ## Build the application
	CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o bin/api ./cmd/api

test: ## Run tests
	go test ./... -v

migrate-up: ## Run database migrations (up)
	go run db/migrate.go -direction=up

migrate-down: ## Rollback database migrations (down)
	go run db/migrate.go -direction=down

clean: ## Clean build artifacts
	rm -rf bin/ tmp/

deps: ## Download dependencies
	go mod download
	go mod tidy

install-air: ## Install Air for hot reload
	go install github.com/air-verse/air@latest
