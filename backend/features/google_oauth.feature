Feature: Google OAuth Authentication
  As a user
  I want to authenticate using Google OAuth
  So that I can log in to the platform

  Background:
    Given the database is clean
    And external HTTP calls are mocked
    And the API server is running

  Scenario: Google OAuth callback with error
    When I send a GET request to "/auth/google/callback?error=access_denied"
    Then the response status code should be 302

  Scenario: Google OAuth callback without code
    When I send a GET request to "/auth/google/callback"
    Then the response status code should be 302

  Scenario: Google OAuth callback with missing code
    When I send a GET request to "/auth/google/callback?code="
    Then the response status code should be 302
