# SED script to update SQL column names from camelCase to snake_case
# Only updates quoted column names in SQL queries

# Posts table columns
s/"teamId"/team_id/g
s/"scheduledFor"/scheduled_for/g
s/"publishedAt"/published_at/g
s/"lastPublishJobId"/last_publish_job_id/g
s/"lastPublishStatus"/last_publish_status/g
s/"lastPublishError"/last_publish_error/g
s/"lastPublishAttemptAt"/last_publish_attempt_at/g

# SocialConnections table columns
s/"providerId"/provider_id/g

# Common columns (used in multiple tables)
s/"userId"/user_id/g
s/"createdAt"/created_at/g
s/"updatedAt"/updated_at/g

# Users table columns
s/"imageUrl"/image_url/g
