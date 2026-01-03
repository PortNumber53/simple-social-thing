Feature: Team Management
  As a user
  I want to create and manage teams
  So that I can collaborate with others

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "owner123" and email "owner@example.com"

  Scenario: Create a new team
    When I send a POST request to "/api/teams" with JSON:
      """
      {
        "id": "team123",
        "ownerId": "owner123"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "id" set to "team123"
    And the response should contain JSON with "ownerId" set to "owner123"

  Scenario: Get a team by ID
    Given a team exists with id "team456" and ownerId "owner123"
    When I send a GET request to "/api/teams/team456"
    Then the response status code should be 200
    And the response should contain JSON with "id" set to "team456"

  Scenario: Get user's teams
    Given a team exists with id "team1" and ownerId "owner123"
    And a team exists with id "team2" and ownerId "owner123"
    And the user "owner123" is a member of team "team1"
    And the user "owner123" is a member of team "team2"
    When I send a GET request to "/api/teams/user/owner123"
    Then the response status code should be 200
    And the response should be a JSON array with 2 items

  Scenario: Get teams for user with no teams
    When I send a GET request to "/api/teams/user/owner123"
    Then the response status code should be 200
    And the response should be a JSON array with 0 items
