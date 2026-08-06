Feature: News Collection
  As a user
  I want to collect news headlines and articles
  So that I can use them for content generation

  Background:
    Given the database is clean
    And external HTTP calls are mocked
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: Collect news headlines
    When I send a POST request to "/api/news/collect/user/user123" with JSON:
      """
      {
        "categories": ["general", "technology"]
      }
      """
    Then the response status code should be 200
    And the response should contain a "headlines" field

  Scenario: Collect news with query filter
    When I send a POST request to "/api/news/collect/user/user123" with JSON:
      """
      {
        "query": "artificial intelligence"
      }
      """
    Then the response status code should be 200

  Scenario: Fetch article content
    When I send a POST request to "/api/news/article/user/user123" with JSON:
      """
      {
        "url": "https://example.com/article"
      }
      """
    Then the response status code should be 200
