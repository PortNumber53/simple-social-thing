Feature: Instagram Agent
  As a user
  I want to use the Instagram AI agent
  So that I can generate engaging content for my posts

  Background:
    Given the database is clean
    And external HTTP calls are mocked
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: Generate Instagram content
    When I send a POST request to "/api/instagram-agent/generate/user/user123" with JSON:
      """
      {
        "type": "caption",
        "input": "sunset photo at the beach",
        "style": "casual",
        "tone": "inspirational",
        "count": 3
      }
      """
    Then the response status code should be 200

  Scenario: Generate content with invalid request
    When I send a POST request to "/api/instagram-agent/generate/user/user123" with JSON:
      """
      {
        "type": "",
        "input": ""
      }
      """
    Then the response status code should be 400

  Scenario: Get Instagram account info
    Given the user "user123" has an "instagram" connection with providerId "ig_account_123"
    When I send a GET request to "/api/instagram-agent/account/user/user123"
    Then the response status code should be 200

  Scenario: Get Instagram insights
    Given the user "user123" has an "instagram" connection with providerId "ig_account_123"
    When I send a GET request to "/api/instagram-agent/insights/user/user123"
    Then the response status code should be 200
