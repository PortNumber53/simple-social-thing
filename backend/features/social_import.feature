Feature: Social Import
  As a user
  I want to import content from my connected social media accounts
  So that I can reuse and repurpose my existing posts

  Background:
    Given the database is clean
    And external HTTP calls are mocked
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"
    And the user "user123" has a "facebook" connection with providerId "fb123"
    And the user "user123" has an "instagram" connection with providerId "ig456"

  Scenario: Import social library items for user
    When I send a POST request to "/api/social-libraries/import/user/user123" with JSON:
      """
      {
        "providers": ["facebook", "instagram"]
      }
      """
    Then the response status code should be 200

  Scenario: List social libraries after import
    Given the user "user123" has social library items
    When I send a GET request to "/api/social-libraries/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array

  Scenario: Delete specific social library items
    Given the user "user123" has social library items
    When I send a POST request to "/api/social-libraries/delete/user/user123" with JSON:
      """
      {
        "ids": ["lib_user123_1"]
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "deleted" count

  Scenario: Get specific social connection by provider
    When I send a GET request to "/api/social-connections/user/user123/facebook"
    Then the response status code should be 200
    And the response should contain JSON with "provider" set to "facebook"

  Scenario: Delete social connection by provider
    When I send a DELETE request to "/api/social-connections/user/user123/facebook"
    Then the response status code should be 200
