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
    And the response should contain JSON with "email" set to "test@example.com"
    And the response should contain JSON with "name" set to "Test User"

  Scenario: Get an existing user
    Given a user exists with id "user456" and email "existing@example.com"
    When I send a GET request to "/api/users/user456"
    Then the response status code should be 200
    And the response should contain JSON with "id" set to "user456"
    And the response should contain JSON with "email" set to "existing@example.com"

  Scenario: Get a non-existent user
    When I send a GET request to "/api/users/nonexistent"
    Then the response status code should be 404
    And the response should contain error "User not found"

  Scenario: Update an existing user
    Given a user exists with id "user789" and email "update@example.com"
    When I send a PUT request to "/api/users/user789" with JSON:
      """
      {
        "name": "Updated Name"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "name" set to "Updated Name"

  Scenario: Create user with upsert behavior
    Given a user exists with id "user999" and email "original@example.com"
    When I send a POST request to "/api/users" with JSON:
      """
      {
        "id": "user999",
        "email": "updated@example.com",
        "name": "Updated User"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "id" set to "user999"
    And the user "user999" should have email "updated@example.com"
