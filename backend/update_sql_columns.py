#!/usr/bin/env python3
"""
Update SQL column names in Go handler files.
Only modifies strings within backtick-quoted SQL queries, not Go code.
"""

import re
import sys

# Column name mappings - simple string replacements
REPLACEMENTS = [
    ('"teamId"', 'team_id'),
    ('"userId"', 'user_id'),
    ('"providerId"', 'provider_id'),
    ('"scheduledFor"', 'scheduled_for'),
    ('"publishedAt"', 'published_at'),
    ('"createdAt"', 'created_at'),
    ('"updatedAt"', 'updated_at'),
    ('"lastPublishJobId"', 'last_publish_job_id'),
    ('"lastPublishStatus"', 'last_publish_status'),
    ('"lastPublishError"', 'last_publish_error'),
    ('"lastPublishAttemptAt"', 'last_publish_attempt_at'),
    ('"imageUrl"', 'image_url'),
]

def extract_sql_queries(content):
    """Extract all backtick-quoted strings (SQL queries) from Go code."""
    # Match backtick strings, including multiline
    pattern = r'`([^`]*)`'
    matches = []
    for match in re.finditer(pattern, content, re.DOTALL):
        start = match.start()
        end = match.end()
        sql = match.group(1)
        matches.append((start, end, sql))
    return matches

def update_sql_in_content(content):
    """Update SQL column names only within backtick strings."""
    queries = extract_sql_queries(content)

    # Process in reverse order to maintain positions
    queries.reverse()

    replacements_made = 0
    for start, end, sql in queries:
        updated_sql = sql
        for old_name, new_name in REPLACEMENTS:
            count = updated_sql.count(old_name)
            if count > 0:
                updated_sql = updated_sql.replace(old_name, new_name)
                replacements_made += count

        if updated_sql != sql:
            # Replace the SQL query in the content
            content = content[:start] + '`' + updated_sql + '`' + content[end:]

    return content, replacements_made

def process_file(filepath):
    """Process a single Go file."""
    print(f"Processing {filepath}...")

    try:
        with open(filepath, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"  Warning: File not found, skipping")
        return 0

    # Create backup
    with open(f"{filepath}.bak", 'w') as f:
        f.write(content)

    # Update SQL queries
    updated_content, count = update_sql_in_content(content)

    # Write updated content
    with open(filepath, 'w') as f:
        f.write(updated_content)

    print(f"  ✓ Made {count} replacements")
    return count

def main():
    files = [
        'internal/handlers/handlers.go',
        'internal/handlers/scheduled_posts_worker.go',
        'internal/handlers/realtime_ws.go',
    ]

    total = 0
    for filepath in files:
        count = process_file(filepath)
        total += count

    print(f"\n✅ Complete! Made {total} total replacements")
    print("\nBackup files: *.bak")
    print("\nTo verify:")
    print("  go build ./...")
    print("\nTo restore:")
    print("  for f in internal/handlers/*.bak; do mv \"$f\" \"${f%.bak}\"; done")

if __name__ == '__main__':
    main()
