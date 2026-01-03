Feature: Media Uploads
  As a user
  I want to upload media files
  So that I can use them in my posts

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: List user uploads
    When I send a GET request to "/api/uploads/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array

  Scenario: Upload a file
    When I send a POST request to "/api/uploads/user/user123" with a file upload:
      | filename    | test.jpg         |
      | contentType | image/jpeg       |
      | size        | 1024             |
    Then the response status code should be 200
    And the response should contain a "url" field
    And the response should contain a "filename" field

  Scenario: Delete user uploads
    Given the user "user123" has uploaded files
    When I send a POST request to "/api/uploads/delete/user/user123" with JSON:
      """
      {
        "files": ["file1.jpg", "file2.png"]
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "deleted" count
