#!/bin/bash
# Script to update all SQL column names from camelCase to snake_case in handler files

set -e

echo "Updating column names in handler files..."

# Files to update
FILES=(
  "internal/handlers/handlers.go"
  "internal/handlers/scheduled_posts_worker.go"
  "internal/handlers/realtime_ws.go"
)

for file in "${FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "Warning: $file not found, skipping..."
    continue
  fi

  echo "Processing $file..."

  # Create backup
  cp "$file" "$file.bak"

  # Posts table columns
  sed -i 's/"teamId"/team_id/g' "$file"
  sed -i 's/"userId"/user_id/g' "$file"
  sed -i 's/"scheduledFor"/scheduled_for/g' "$file"
  sed -i 's/"publishedAt"/published_at/g' "$file"
  sed -i 's/"createdAt"/created_at/g' "$file"
  sed -i 's/"updatedAt"/updated_at/g' "$file"
  sed -i 's/"lastPublishJobId"/last_publish_job_id/g' "$file"
  sed -i 's/"lastPublishStatus"/last_publish_status/g' "$file"
  sed -i 's/"lastPublishError"/last_publish_error/g' "$file"
  sed -i 's/"lastPublishAttemptAt"/last_publish_attempt_at/g' "$file"

  # SocialConnections table columns
  sed -i 's/"providerId"/provider_id/g' "$file"

  # Teams table columns
  sed -i 's/"owner_id"/owner_id/g' "$file"
  sed -i 's/"current_tier"/current_tier/g' "$file"
  sed -i 's/"posts_created_today"/posts_created_today/g' "$file"
  sed -i 's/"usage_reset_date"/usage_reset_date/g' "$file"
  sed -i 's/"ig_llat"/ig_llat/g' "$file"
  sed -i 's/"stripe_customer_id"/stripe_customer_id/g' "$file"
  sed -i 's/"stripe_subscription_id"/stripe_subscription_id/g' "$file"

  # Users table columns (imageUrl is the only camelCase one)
  sed -i 's/"imageUrl"/image_url/g' "$file"

  echo "✓ Updated $file"
done

echo ""
echo "Column name updates complete!"
echo "Backup files created with .bak extension"
echo ""
echo "To verify changes:"
echo "  diff internal/handlers/handlers.go.bak internal/handlers/handlers.go | head -50"
echo ""
echo "To restore from backup if needed:"
echo "  mv internal/handlers/handlers.go.bak internal/handlers/handlers.go"
