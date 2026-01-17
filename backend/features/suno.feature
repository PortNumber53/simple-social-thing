Feature: Suno AI Music Integration
  As a user
  I want to generate AI music tracks
  So that I can use them in my social media content

  Background:
    Given the database is clean
    And external HTTP calls are mocked
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: Create a Suno task
    When I send a POST request to "/api/suno/tasks" with JSON:
      """
      {
        "userId": "user123",
        "prompt": "upbeat electronic music",
        "duration": 30
      }
      """
    Then the response status code should be 200
    And the response should contain a "taskId"

  Scenario: List user's Suno tracks
    Given the user "user123" has 3 Suno tracks
    When I send a GET request to "/api/suno/tracks/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array with 3 items

  Scenario: Update a Suno track
    Given the user "user123" has a Suno track with id "track123"
    When I send a PUT request to "/api/suno/tracks/track123" with JSON:
      """
      {
        "title": "My Custom Track"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "title" set to "My Custom Track"

  Scenario: Store a Suno track
    When I send a POST request to "/api/suno/store" with JSON:
      """
      {
        "userId": "user123",
        "trackId": "suno_track_456",
        "url": "https://example.com/track.mp3",
        "title": "Generated Track"
      }
      """
    Then the response status code should be 200
    And the response should contain the stored track data

  Scenario: Suno music callback
    When I send a POST request to "/callback/suno/music" with JSON:
      """
      {
        "taskId": "task789",
        "status": "completed",
        "audioUrl": "https://example.com/audio.mp3"
      }
      """
    Then the response status code should be 200
