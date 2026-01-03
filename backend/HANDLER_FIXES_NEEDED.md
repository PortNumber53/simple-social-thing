# Handler Code Fixes Needed for BDD Tests

## Analysis Summary

The BDD tests revealed that the **handler code still uses old camelCase column names** while the database schema now uses snake_case (after migrations 018-024). This causes SQL errors when handlers try to query the database.

## Critical Issues (Causing 500 Errors)

### 1. Posts Table - Handler Uses Old Column Names
**Error**: `pq: column "teamId" of relation "Posts" does not exist`

**Affected Handlers**:
- `CreatePostForUser` - Line ~1192
- `ListPostsForUser`
- `UpdatePostForUser`
- `DeletePostForUser`
- `PublishNowPostForUser`

**Old Code** (handlers.go:1192-1195):
```sql
INSERT INTO public."Posts" (id, "teamId", "userId", content, status, providers, media, "scheduledFor", "publishedAt", "createdAt", "updatedAt")
VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
RETURNING id, COALESCE("teamId",''), "userId", content, status, ...
```

**Should Be**:
```sql
INSERT INTO public."Posts" (id, team_id, user_id, content, status, providers, media, scheduled_for, published_at, created_at, updated_at)
VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
RETURNING id, COALESCE(team_id,''), user_id, content, status, ...
```

**Columns to Fix**:
- `"teamId"` → `team_id`
- `"userId"` → `user_id`
- `"scheduledFor"` → `scheduled_for`
- `"publishedAt"` → `published_at`
- `"createdAt"` → `created_at`
- `"updatedAt"` → `updated_at`
- `"lastPublishJobId"` → `last_publish_job_id`
- `"lastPublishStatus"` → `last_publish_status`
- `"lastPublishError"` → `last_publish_error`
- `"lastPublishAttemptAt"` → `last_publish_attempt_at`

### 2. SocialConnections Table - Handler Uses Old Column Names
**Error**: `pq: column "userId" of relation "SocialConnections" does not exist`

**Affected Handlers**:
- `CreateSocialConnection` - Line ~140
- `GetUserSocialConnections` - Line ~163

**Old Code** (handlers.go:140-145):
```sql
INSERT INTO public."SocialConnections" (id, "userId", provider, "providerId", email, name, "createdAt")
VALUES ($1, $2, $3, $4, $5, $6, NOW())
ON CONFLICT ("userId", provider) DO UPDATE SET
    "providerId" = EXCLUDED."providerId",
```

**Should Be**:
```sql
INSERT INTO public."SocialConnections" (id, user_id, provider, provider_id, email, name, created_at)
VALUES ($1, $2, $3, $4, $5, $6, NOW())
ON CONFLICT (user_id, provider) DO UPDATE SET
    provider_id = EXCLUDED.provider_id,
```

**Columns to Fix**:
- `"userId"` → `user_id`
- `"providerId"` → `provider_id`
- `"createdAt"` → `created_at`

### 3. PublishJobs Table - Handler Uses Old Column Names
**Error**: `pq: column "request" of relation "PublishJobs" does not exist`

**Affected Handlers**:
- `EnqueuePublishJobForUser` - Line ~1457
- `GetPublishJob`
- Various publish helpers

**Old Code** (handlers.go:1457-1460):
```sql
INSERT INTO public."PublishJobs"
  (id, user_id, status, providers, caption, request_json, created_at, updated_at)
VALUES
  ($1, $2, 'queued', $3, $4, $5::jsonb, $6, $6)
```

**Issue**: Column is named `request` in schema but handler uses `request_json`

**Need to verify actual schema column name and update accordingly**

### 4. Notifications Table - Missing Required Column
**Error**: `pq: null value in column "title" of relation "Notifications" violates not-null constraint`

**Affected Handlers**:
- `createNotification` - Line ~987

**Current Code** (handlers.go:987-989):
```sql
INSERT INTO public."Notifications" (id, user_id, type, title, body, url, created_at)
VALUES ($1, $2, $3, $4, $5, $6, NOW())
```

**Issue**: The `title` column is NOT NULL but test code only provides `message`

**Fix Options**:
1. Make `title` nullable in schema
2. Update handler to use `message` for `title` when `title` is not provided
3. Update test code to provide both `message` and `title`

## API Validation Issues (400 Errors)

### 5. Publishing Requires Media for Instagram
**Error**: `media is required for the selected provider(s)`

**Test Expectation**: Dry run should work without media
**Handler Behavior**: Validates media is required for Instagram even in dry run

**Fix**: Update validation to skip media requirement when `dryRun: true`

### 6. Suno Endpoints Missing Required Fields
**Errors**:
- `taskId is required`
- `audioUrl is required`

**Test Expectations**: Tests don't provide these fields
**Handler Behavior**: Requires these fields

**Fix Options**:
1. Update test requests to include required fields
2. Make fields optional in handlers (if appropriate)
3. Update feature files to match actual API requirements

### 7. Upload Endpoints Validation
**Errors**:
- `missing files` - Upload endpoint expects multipart file
- `ids is required` - Delete endpoint expects array of IDs

**Fix**: Update test step definitions to properly format:
- Multipart file uploads
- JSON arrays for delete operations

## Routing Issues (404 Errors)

### 8. Suno Music Callback Route Missing
**Error**: `404 page not found` for `/callback/suno/music`

**Issue**: Route may not be registered or path doesn't match

**Check**: `main.go` router configuration for Suno callback routes

## Security/Auth Issues

### 9. WebSocket Auth from Localhost
**Error**: Expected 403, got 200 for non-localhost without auth

**Test Expectation**: Reject connections without internal auth from non-localhost
**Handler Behavior**: Accepts connections from localhost even without auth

**Issue**: Test is running on localhost (127.0.0.1) so the localhost bypass applies

**Fix**: Test needs to mock non-localhost IP or handler needs stricter validation

## Summary of Files Needing Updates

### High Priority (Causing 500 Errors)
1. **`internal/handlers/handlers.go`** - ~277 instances of old column names
   - All Posts table queries
   - All SocialConnections queries
   - PublishJobs queries
   - Notifications queries

2. **`internal/handlers/scheduled_posts_worker.go`** - ~36 instances
   - Background worker queries

3. **`internal/handlers/realtime_ws.go`** - ~33 instances
   - WebSocket handler queries

### Medium Priority (Test Improvements)
4. **`bdd_test.go`** - Update test step definitions:
   - File upload handling
   - Array parameter formatting
   - Add missing required fields to requests

5. **`features/*.feature`** - Update scenarios:
   - Add required fields (taskId, audioUrl, etc.)
   - Match actual API requirements

### Low Priority (Documentation)
6. **`BDD_TESTING.md`** - Document known limitations
7. **`README.md`** - Update API examples with correct field names

## Recommended Fix Order

1. **Create migration to check PublishJobs schema** - Verify column names
2. **Fix Notifications handler** - Make title optional or use message
3. **Update all handlers to use snake_case columns** - Critical for tests to pass
4. **Update test step definitions** - File uploads, arrays
5. **Update feature files** - Add required fields
6. **Fix routing** - Add missing Suno callback route
7. **Update validation** - Handle dry run mode properly

## Estimated Impact

**After fixing handler column names**:
- Expected: ~35-40 scenarios passing (up from 23)
- Remaining failures will be API validation and test implementation issues

**After all fixes**:
- Expected: ~45-48 scenarios passing (94-100%)
