#!/usr/bin/env python3
"""
Update SQL column names from camelCase to snake_case in handler files.
Only updates column names within SQL query strings, not Go variable names.
"""

import re
import sys

# Column name mappings (old -> new)
COLUMN_MAPPINGS = {
    # Posts table
    '"teamId"': 'team_id',
    '"userId"': 'user_id',
    '"scheduledFor"': 'scheduled_for',
    '"publishedAt"': 'published_at',
    '"createdAt"': 'created_at',
    '"updatedAt"': 'updated_at',
    '"lastPublishJobId"': 'last_publish_job_id',
    '"lastPublishStatus"': 'last_publish_status',
    '"lastPublishError"': 'last_publish_error',
    '"lastPublishAttemptAt"': 'last_publish_attempt_at',

    # SocialConnections table
    '"providerId"': 'provider_id',

    # Users table
    '"imageUrl"': 'image_url',
}

def update_file(filepath):
    """Update column names in a single file."""
    print(f"Processing {filepath}...")

    with open(filepath, 'r') as f:
        content = f.read()

    # Create backup
    with open(f"{filepath}.bak", 'w') as f:
        f.write(content)

    # Apply replacements
    updated_content = content
    replacements_made = 0

    for old_name, new_name in COLUMN_MAPPINGS.items():
        count = updated_content.count(old_name)
        if count > 0:
            updated_content = updated_content.replace(old_name, new_name)
            replacements_made += count
            print(f"  Replaced {old_name} -> {new_name} ({count} times)")

    # Write updated content
    with open(filepath, 'w') as f:
        f.write(updated_content)

    print(f"✓ Updated {filepath} ({replacements_made} replacements)")
    return replacements_made

def main():
    files = [
        'internal/handlers/handlers.go',
        'internal/handlers/scheduled_posts_worker.go',
        'internal/handlers/realtime_ws.go',
    ]

    total_replacements = 0
    for filepath in files:
        try:
            count = update_file(filepath)
            total_replacements += count
        except FileNotFoundError:
            print(f"Warning: {filepath} not found, skipping...")
        except Exception as e:
            print(f"Error processing {filepath}: {e}")
            sys.exit(1)

    print(f"\n✅ Complete! Made {total_replacements} total replacements")
    print("\nBackup files created with .bak extension")
    print("\nTo verify changes:")
    print("  diff internal/handlers/handlers.go.bak internal/handlers/handlers.go | head -50")
    print("\nTo restore from backup if needed:")
    print("  for f in internal/handlers/*.bak; do mv \"$f\" \"${f%.bak}\"; done")

if __name__ == '__main__':
    main()
