Feature: Notifications
  As a user
  I want to receive and manage notifications
  So that I can stay informed about system events

  Background:
    Given the database is clean
    And the API server is running
    And a user exists with id "user123" and email "test@example.com"

  Scenario: List user notifications
    Given the user "user123" has 5 notifications
    When I send a GET request to "/api/notifications/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array with 5 items

  Scenario: Mark notification as read
    Given the user "user123" has a notification with id "notif123"
    When I send a POST request to "/api/notifications/notif123/read/user/user123"
    Then the response status code should be 200
    And the notification "notif123" should be marked as read

  Scenario: List notifications for user with no notifications
    When I send a GET request to "/api/notifications/user/user123"
    Then the response status code should be 200
    And the response should be a JSON array with 0 items
