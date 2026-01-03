Feature: Social Connections
  As a user
  I want to connect my social media accounts
  So that I can publish content to multiple platforms

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: Create a Facebook connection
    When I send a POST request to "/api/social-connections" with JSON:
      """
      {
        "userId": "user123",
        "provider": "facebook",
        "providerId": "fb123456",
        "email": "test@facebook.com",
        "name": "Test User FB"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "provider" set to "facebook"
    And the response should contain JSON with "providerId" set to "fb123456"

  Scenario: Create an Instagram connection
    When I send a POST request to "/api/social-connections" with JSON:
      """
      {
        "userId": "user123",
        "provider": "instagram",
        "providerId": "ig987654",
        "name": "Test User IG"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "provider" set to "instagram"

  Scenario: Get user's social connections
    Given the user "user123" has a "facebook" connection with providerId "fb123"
    And the user "user123" has an "instagram" connection with providerId "ig456"
    When I send a GET request to "/api/social-connections/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array with 2 items
    And the response should contain a connection with provider "facebook"
    And the response should contain a connection with provider "instagram"

  Scenario: Get connections for user with no connections
    When I send a GET request to "/api/social-connections/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array with 0 items
