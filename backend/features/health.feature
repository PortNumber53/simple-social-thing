Feature: Health Check
  As a system administrator
  I want to check the health of the API
  So that I can monitor the service availability

  Scenario: Health endpoint returns OK
    Given the API server is running
    When I send a GET request to "/health"
    Then the response status code should be 200
    And the response should contain JSON with "ok" set to true
