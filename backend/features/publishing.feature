Feature: Social Media Publishing
  As a user
  I want to publish content to social media platforms
  So that I can share my content across multiple channels

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: Publish a text-only post (dry run)
    When I send a POST request to "/api/social-posts/publish/user/user123" with JSON:
      """
      {
        "caption": "Hello world!",
        "providers": ["facebook"],
        "dryRun": true
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "ok" set to true
    And the response should contain "results" with provider "facebook"

  Scenario: Enqueue async publish job
    When I send a POST request to "/api/social-posts/publish-async/user/user123" with JSON:
      """
      {
        "caption": "Async post",
        "providers": ["facebook", "instagram"]
      }
      """
    Then the response status code should be 200
    And the response should contain a "jobId"
    And the response should contain JSON with "status" set to "pending"

  Scenario: Get publish job status
    Given a publish job exists with id "job123" for user "user123"
    When I send a GET request to "/api/social-posts/publish-jobs/job123"
    Then the response status code should be 200
    And the response should contain JSON with "id" set to "job123"
    And the response should contain a "status" field

  Scenario: Publish with unsupported provider
    When I send a POST request to "/api/social-posts/publish/user/user123" with JSON:
      """
      {
        "caption": "Test post",
        "providers": ["tiktok"],
        "dryRun": true
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "ok" set to false
    And the results for "tiktok" should contain error "not_supported_yet"

  Scenario: Publish without caption
    When I send a POST request to "/api/social-posts/publish/user/user123" with JSON:
      """
      {
        "providers": ["facebook"]
      }
      """
    Then the response status code should be 400
    And the response should contain error "caption is required"
