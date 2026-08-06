Feature: Session Management
  As a user
  I want to create and manage my sessions
  So that I can authenticate with the API

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: Create a new session
    When I send a POST request to "/api/sessions" with JSON:
      """
      {
        "userId": "user123"
      }
      """
    Then the response status code should be 201
    And the response should contain a "token" field
    And the response should contain JSON with "userId" set to "user123"

  Scenario: Resolve a valid session
    Given a session exists for user "user123" with token "test-token-123"
    When I send a GET request to "/api/sessions/test-token-123"
    Then the response status code should be 200
    And the response should contain JSON with "userId" set to "user123"

  Scenario: Resolve a non-existent session
    When I send a GET request to "/api/sessions/nonexistent-token"
    Then the response status code should be 404
    And the response should contain error "session not found"

  Scenario: Create session without userId
    When I send a POST request to "/api/sessions" with JSON:
      """
      {
        "userId": ""
      }
      """
    Then the response status code should be 400
    And the response should contain error "userId is required"

  Scenario: Delete a session
    Given a session exists for user "user123" with token "delete-token-456"
    When I send a DELETE request to "/api/sessions/delete-token-456"
    Then the response status code should be 200
    And the response should contain JSON with "ok" set to "true"
