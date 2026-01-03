Feature: User Settings
  As a user
  I want to manage my personal settings
  So that I can customize my experience

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: Get all user settings
    Given the user "user123" has settings configured
    When I send a GET request to "/api/user-settings/user123"
    Then the response status code should be 200
    And the response should be a JSON object

  Scenario: Get a specific user setting
    Given the user "user123" has a setting "theme" with value "dark"
    When I send a GET request to "/api/user-settings/user123/theme"
    Then the response status code should be 200
    And the response should contain JSON with "key" set to "theme"
    And the response should contain JSON with "value" set to "dark"

  Scenario: Upsert a user setting
    When I send a PUT request to "/api/user-settings/user123/language" with JSON:
      """
      {
        "value": "en-US"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "key" set to "language"
    And the response should contain JSON with "value" set to "en-US"

  Scenario: Update existing user setting
    Given the user "user123" has a setting "notifications" with value "enabled"
    When I send a PUT request to "/api/user-settings/user123/notifications" with JSON:
      """
      {
        "value": "disabled"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "value" set to "disabled"
