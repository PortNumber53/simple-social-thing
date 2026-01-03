Feature: Social Library
  As a user
  I want to import and manage my social media content
  So that I can reuse content from my connected platforms

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"
    And the user "user123" has a "facebook" connection with providerId "fb123"

  Scenario: List user's social library items
    When I send a GET request to "/api/social-libraries/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array

  Scenario: Sync social libraries for user
    When I send a POST request to "/api/social-libraries/sync/user/user123"
    Then the response status code should be 200
    And the response should contain sync results

  Scenario: Delete social library items
    Given the user "user123" has social library items
    When I send a POST request to "/api/social-libraries/delete/user/user123" with JSON:
      """
      {
        "ids": ["lib1", "lib2"]
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "deleted" count
