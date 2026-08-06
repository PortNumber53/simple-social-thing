Feature: Billing and Subscriptions
  As a user
  I want to manage my subscription and billing
  So that I can access premium features

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: List available billing plans
    When I send a GET request to "/api/billing/plans"
    Then the response status code should be 200
    And the response should be a JSON array

  Scenario: Get user subscription with no subscription
    When I send a GET request to "/api/billing/subscription/user/user123"
    Then the response status code should be 200
    And the response should contain a "status" field

  Scenario: Get user invoices with no invoices
    When I send a GET request to "/api/billing/invoices/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array

  Scenario: Create custom plan request
    When I send a POST request to "/api/billing/custom-plan-requests/user/user123" with JSON:
      """
      {
        "postsPerDay": 50,
        "platforms": ["facebook", "instagram", "tiktok"],
        "notes": "Need high volume for agency"
      }
      """
    Then the response status code should be 200
    And the response should contain JSON with "ok" set to "true"

  Scenario: Get custom plan requests as admin
    Given the user "user123" has a custom plan request
    When I send a GET request to "/api/billing/custom-plan-requests/admin/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array
