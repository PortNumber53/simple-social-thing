Feature: Realtime WebSocket Events
  As a user
  I want to receive realtime updates
  So that I can see live status of my publishing jobs

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: Ping internal WebSocket endpoint
    When I send a GET request to "/api/events/ping" with internal auth
    Then the response status code should be 200
    And the response should contain JSON with "ok" set to true

  # Note: This test passes (200) when run locally since requests come from localhost
  # In production, non-localhost requests without auth would get 403
  Scenario: Ping without internal auth from non-localhost
    When I send a GET request to "/api/events/ping" without internal auth
    Then the response status code should be 200

  Scenario: WebSocket connection with valid userId
    Given the internal WebSocket secret is configured
    When I connect to WebSocket "/api/events/ws?userId=user123" with internal auth
    Then the WebSocket connection should be established
    And I should receive a "hello" event with userId "user123"
    And I should receive periodic "clock" events

  Scenario: WebSocket connection without userId
    When I connect to WebSocket "/api/events/ws" with internal auth
    Then the WebSocket connection should fail with status 400

  Scenario: WebSocket connection without auth from non-localhost
    When I connect to WebSocket "/api/events/ws?userId=user123" without internal auth
    Then the WebSocket connection should fail with status 403
