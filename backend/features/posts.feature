Feature: Post Management
  As a user
  I want to create and manage posts
  So that I can schedule and publish content

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"
    And a team exists with id "team123" and ownerId "user123"

  Scenario: Create a draft post
    When I send a POST request to "/api/posts/user/user123" with JSON:
      """
      {
        "teamId": "team123",
        "content": "My first post!",
        "status": "draft"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "status" set to "draft"
    And the response should contain JSON with "content" set to "My first post!"

  Scenario: Create a scheduled post
    When I send a POST request to "/api/posts/user/user123" with JSON:
      """
      {
        "teamId": "team123",
        "content": "Scheduled content",
        "status": "scheduled",
        "scheduledFor": "2025-12-31T12:00:00Z",
        "providers": ["facebook", "instagram"],
        "media": ["/media/uploads/user123/test-image.jpg"]
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "status" set to "scheduled"
    And the response should contain a "scheduledFor" timestamp

  Scenario: List user's posts
    Given the user "user123" has 3 posts in team "team123"
    When I send a GET request to "/api/posts/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array with 3 items

  Scenario: Update a post
    Given the user "user123" has a post with id "post123" in team "team123"
    When I send a PUT request to "/api/posts/post123/user/user123" with JSON:
      """
      {
        "content": "Updated content",
        "status": "draft"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "content" set to "Updated content"

  Scenario: Delete a post
    Given the user "user123" has a post with id "post456" in team "team123"
    When I send a DELETE request to "/api/posts/post456/user/user123"
    Then the response status code should be 200
    And the post "post456" should not exist

  Scenario: Publish a scheduled post immediately
    Given the user "user123" has a scheduled post with id "post789" in team "team123"
    When I send a POST request to "/api/posts/post789/publish-now/user/user123"
    Then the response status code should be 200
    And the response should contain a "jobId"
