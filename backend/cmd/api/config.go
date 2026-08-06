package main

import "github.com/PortNumber53/simple-social-thing/backend/internal/config"

func loadEnvironment() error {
	return config.Load()
}
