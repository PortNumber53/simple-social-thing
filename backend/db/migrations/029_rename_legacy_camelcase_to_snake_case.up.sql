-- Rename legacy quoted CamelCase tables/columns to snake_case.
-- This is intended for older production DBs that predate the snake_case normalization.
-- It is guarded to be safe when the DB is already snake_case.

DO $$
BEGIN
  -- Tables
  IF to_regclass('public.users') IS NULL AND to_regclass('public."Users"') IS NOT NULL THEN
    ALTER TABLE public."Users" RENAME TO users;
  END IF;
  IF to_regclass('public.teams') IS NULL AND to_regclass('public."Teams"') IS NOT NULL THEN
    ALTER TABLE public."Teams" RENAME TO teams;
  END IF;
  IF to_regclass('public.team_members') IS NULL AND to_regclass('public."TeamMembers"') IS NOT NULL THEN
    ALTER TABLE public."TeamMembers" RENAME TO team_members;
  END IF;
  IF to_regclass('public.social_connections') IS NULL AND to_regclass('public."SocialConnections"') IS NOT NULL THEN
    ALTER TABLE public."SocialConnections" RENAME TO social_connections;
  END IF;
  IF to_regclass('public.posts') IS NULL AND to_regclass('public."Posts"') IS NOT NULL THEN
    ALTER TABLE public."Posts" RENAME TO posts;
  END IF;
  IF to_regclass('public.suno_tracks') IS NULL AND to_regclass('public."SunoTracks"') IS NOT NULL THEN
    ALTER TABLE public."SunoTracks" RENAME TO suno_tracks;
  END IF;
  IF to_regclass('public.user_settings') IS NULL AND to_regclass('public."UserSettings"') IS NOT NULL THEN
    ALTER TABLE public."UserSettings" RENAME TO user_settings;
  END IF;
  IF to_regclass('public.social_libraries') IS NULL AND to_regclass('public."SocialLibraries"') IS NOT NULL THEN
    ALTER TABLE public."SocialLibraries" RENAME TO social_libraries;
  END IF;
  IF to_regclass('public.social_import_states') IS NULL AND to_regclass('public."SocialImportStates"') IS NOT NULL THEN
    ALTER TABLE public."SocialImportStates" RENAME TO social_import_states;
  END IF;
  IF to_regclass('public.social_import_usage') IS NULL AND to_regclass('public."SocialImportUsage"') IS NOT NULL THEN
    ALTER TABLE public."SocialImportUsage" RENAME TO social_import_usage;
  END IF;
  IF to_regclass('public.publish_jobs') IS NULL AND to_regclass('public."PublishJobs"') IS NOT NULL THEN
    ALTER TABLE public."PublishJobs" RENAME TO publish_jobs;
  END IF;
  IF to_regclass('public.notifications') IS NULL AND to_regclass('public."Notifications"') IS NOT NULL THEN
    ALTER TABLE public."Notifications" RENAME TO notifications;
  END IF;
END $$;

-- Columns (best-effort; only rename when camelCase exists and snake_case doesn't)

DO $$
BEGIN
  -- users
  IF to_regclass('public.users') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='imageUrl')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='image_url') THEN
      EXECUTE 'ALTER TABLE public.users RENAME COLUMN "imageUrl" TO image_url';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.users RENAME COLUMN "createdAt" TO created_at';
    END IF;
  END IF;

  -- teams
  IF to_regclass('public.teams') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.teams RENAME COLUMN "createdAt" TO created_at';
    END IF;
  END IF;

  -- team_members
  IF to_regclass('public.team_members') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='team_members' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='team_members' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.team_members RENAME COLUMN "createdAt" TO created_at';
    END IF;
  END IF;

  -- social_connections
  IF to_regclass('public.social_connections') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_connections' AND column_name='userId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_connections' AND column_name='user_id') THEN
      EXECUTE 'ALTER TABLE public.social_connections RENAME COLUMN "userId" TO user_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_connections' AND column_name='providerId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_connections' AND column_name='provider_id') THEN
      EXECUTE 'ALTER TABLE public.social_connections RENAME COLUMN "providerId" TO provider_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_connections' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_connections' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.social_connections RENAME COLUMN "createdAt" TO created_at';
    END IF;
  END IF;

  -- posts
  IF to_regclass('public.posts') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='teamId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='team_id') THEN
      EXECUTE 'ALTER TABLE public.posts RENAME COLUMN "teamId" TO team_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='userId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='user_id') THEN
      EXECUTE 'ALTER TABLE public.posts RENAME COLUMN "userId" TO user_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='scheduledFor')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='scheduled_for') THEN
      EXECUTE 'ALTER TABLE public.posts RENAME COLUMN "scheduledFor" TO scheduled_for';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='publishedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='published_at') THEN
      EXECUTE 'ALTER TABLE public.posts RENAME COLUMN "publishedAt" TO published_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.posts RENAME COLUMN "createdAt" TO created_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='updatedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='updated_at') THEN
      EXECUTE 'ALTER TABLE public.posts RENAME COLUMN "updatedAt" TO updated_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='lastPublishJobId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='last_publish_job_id') THEN
      EXECUTE 'ALTER TABLE public.posts RENAME COLUMN "lastPublishJobId" TO last_publish_job_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='lastPublishStatus')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='last_publish_status') THEN
      EXECUTE 'ALTER TABLE public.posts RENAME COLUMN "lastPublishStatus" TO last_publish_status';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='lastPublishError')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='last_publish_error') THEN
      EXECUTE 'ALTER TABLE public.posts RENAME COLUMN "lastPublishError" TO last_publish_error';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='lastPublishAttemptAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='last_publish_attempt_at') THEN
      EXECUTE 'ALTER TABLE public.posts RENAME COLUMN "lastPublishAttemptAt" TO last_publish_attempt_at';
    END IF;
  END IF;

  -- suno_tracks
  IF to_regclass('public.suno_tracks') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='userId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='user_id') THEN
      EXECUTE 'ALTER TABLE public.suno_tracks RENAME COLUMN "userId" TO user_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='sunoTrackId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='suno_track_id') THEN
      EXECUTE 'ALTER TABLE public.suno_tracks RENAME COLUMN "sunoTrackId" TO suno_track_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='audioUrl')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='audio_url') THEN
      EXECUTE 'ALTER TABLE public.suno_tracks RENAME COLUMN "audioUrl" TO audio_url';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='filePath')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='file_path') THEN
      EXECUTE 'ALTER TABLE public.suno_tracks RENAME COLUMN "filePath" TO file_path';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='taskId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='task_id') THEN
      EXECUTE 'ALTER TABLE public.suno_tracks RENAME COLUMN "taskId" TO task_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.suno_tracks RENAME COLUMN "createdAt" TO created_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='updatedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='suno_tracks' AND column_name='updated_at') THEN
      EXECUTE 'ALTER TABLE public.suno_tracks RENAME COLUMN "updatedAt" TO updated_at';
    END IF;
  END IF;

  -- user_settings
  IF to_regclass('public.user_settings') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings' AND column_name='userId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings' AND column_name='user_id') THEN
      EXECUTE 'ALTER TABLE public.user_settings RENAME COLUMN "userId" TO user_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.user_settings RENAME COLUMN "createdAt" TO created_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings' AND column_name='updatedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_settings' AND column_name='updated_at') THEN
      EXECUTE 'ALTER TABLE public.user_settings RENAME COLUMN "updatedAt" TO updated_at';
    END IF;
  END IF;

  -- social_libraries
  IF to_regclass('public.social_libraries') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='userId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='user_id') THEN
      EXECUTE 'ALTER TABLE public.social_libraries RENAME COLUMN "userId" TO user_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='contentType')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='content_type') THEN
      EXECUTE 'ALTER TABLE public.social_libraries RENAME COLUMN "contentType" TO content_type';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='permalinkUrl')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='permalink_url') THEN
      EXECUTE 'ALTER TABLE public.social_libraries RENAME COLUMN "permalinkUrl" TO permalink_url';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='postedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='posted_at') THEN
      EXECUTE 'ALTER TABLE public.social_libraries RENAME COLUMN "postedAt" TO posted_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='mediaUrl')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='media_url') THEN
      EXECUTE 'ALTER TABLE public.social_libraries RENAME COLUMN "mediaUrl" TO media_url';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='thumbnailUrl')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='thumbnail_url') THEN
      EXECUTE 'ALTER TABLE public.social_libraries RENAME COLUMN "thumbnailUrl" TO thumbnail_url';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='externalId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='external_id') THEN
      EXECUTE 'ALTER TABLE public.social_libraries RENAME COLUMN "externalId" TO external_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='rawPayload')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='raw_payload') THEN
      EXECUTE 'ALTER TABLE public.social_libraries RENAME COLUMN "rawPayload" TO raw_payload';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.social_libraries RENAME COLUMN "createdAt" TO created_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='updatedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_libraries' AND column_name='updated_at') THEN
      EXECUTE 'ALTER TABLE public.social_libraries RENAME COLUMN "updatedAt" TO updated_at';
    END IF;
  END IF;

  -- social_import_states
  IF to_regclass('public.social_import_states') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='userId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='user_id') THEN
      EXECUTE 'ALTER TABLE public.social_import_states RENAME COLUMN "userId" TO user_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='lastRunAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='last_run_at') THEN
      EXECUTE 'ALTER TABLE public.social_import_states RENAME COLUMN "lastRunAt" TO last_run_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='lastSuccessAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='last_success_at') THEN
      EXECUTE 'ALTER TABLE public.social_import_states RENAME COLUMN "lastSuccessAt" TO last_success_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='lastError')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='last_error') THEN
      EXECUTE 'ALTER TABLE public.social_import_states RENAME COLUMN "lastError" TO last_error';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='nextRunAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='next_run_at') THEN
      EXECUTE 'ALTER TABLE public.social_import_states RENAME COLUMN "nextRunAt" TO next_run_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.social_import_states RENAME COLUMN "createdAt" TO created_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='updatedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_states' AND column_name='updated_at') THEN
      EXECUTE 'ALTER TABLE public.social_import_states RENAME COLUMN "updatedAt" TO updated_at';
    END IF;
  END IF;

  -- social_import_usage
  IF to_regclass('public.social_import_usage') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_usage' AND column_name='lastUpdatedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='social_import_usage' AND column_name='last_updated_at') THEN
      EXECUTE 'ALTER TABLE public.social_import_usage RENAME COLUMN "lastUpdatedAt" TO last_updated_at';
    END IF;
  END IF;

  -- publish_jobs
  IF to_regclass('public.publish_jobs') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='userId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='user_id') THEN
      EXECUTE 'ALTER TABLE public.publish_jobs RENAME COLUMN "userId" TO user_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='requestJson')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='request_json') THEN
      EXECUTE 'ALTER TABLE public.publish_jobs RENAME COLUMN "requestJson" TO request_json';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='resultJson')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='result_json') THEN
      EXECUTE 'ALTER TABLE public.publish_jobs RENAME COLUMN "resultJson" TO result_json';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.publish_jobs RENAME COLUMN "createdAt" TO created_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='startedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='started_at') THEN
      EXECUTE 'ALTER TABLE public.publish_jobs RENAME COLUMN "startedAt" TO started_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='finishedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='finished_at') THEN
      EXECUTE 'ALTER TABLE public.publish_jobs RENAME COLUMN "finishedAt" TO finished_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='updatedAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='publish_jobs' AND column_name='updated_at') THEN
      EXECUTE 'ALTER TABLE public.publish_jobs RENAME COLUMN "updatedAt" TO updated_at';
    END IF;
  END IF;

  -- notifications
  IF to_regclass('public.notifications') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='userId')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='user_id') THEN
      EXECUTE 'ALTER TABLE public.notifications RENAME COLUMN "userId" TO user_id';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='createdAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='created_at') THEN
      EXECUTE 'ALTER TABLE public.notifications RENAME COLUMN "createdAt" TO created_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='readAt')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='read_at') THEN
      EXECUTE 'ALTER TABLE public.notifications RENAME COLUMN "readAt" TO read_at';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='isRead')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='is_read') THEN
      EXECUTE 'ALTER TABLE public.notifications RENAME COLUMN "isRead" TO is_read';
    END IF;
  END IF;
END $$;

