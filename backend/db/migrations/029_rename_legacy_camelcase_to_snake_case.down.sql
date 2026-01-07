-- Rollback: rename snake_case tables back to quoted CamelCase.
-- NOTE: This is best-effort and primarily intended for local/dev rollback.

DO $$
BEGIN
  IF to_regclass('public."Users"') IS NULL AND to_regclass('public.users') IS NOT NULL THEN
    ALTER TABLE public.users RENAME TO "Users";
  END IF;
  IF to_regclass('public."Teams"') IS NULL AND to_regclass('public.teams') IS NOT NULL THEN
    ALTER TABLE public.teams RENAME TO "Teams";
  END IF;
  IF to_regclass('public."TeamMembers"') IS NULL AND to_regclass('public.team_members') IS NOT NULL THEN
    ALTER TABLE public.team_members RENAME TO "TeamMembers";
  END IF;
  IF to_regclass('public."SocialConnections"') IS NULL AND to_regclass('public.social_connections') IS NOT NULL THEN
    ALTER TABLE public.social_connections RENAME TO "SocialConnections";
  END IF;
  IF to_regclass('public."Posts"') IS NULL AND to_regclass('public.posts') IS NOT NULL THEN
    ALTER TABLE public.posts RENAME TO "Posts";
  END IF;
  IF to_regclass('public."SunoTracks"') IS NULL AND to_regclass('public.suno_tracks') IS NOT NULL THEN
    ALTER TABLE public.suno_tracks RENAME TO "SunoTracks";
  END IF;
  IF to_regclass('public."UserSettings"') IS NULL AND to_regclass('public.user_settings') IS NOT NULL THEN
    ALTER TABLE public.user_settings RENAME TO "UserSettings";
  END IF;
  IF to_regclass('public."SocialLibraries"') IS NULL AND to_regclass('public.social_libraries') IS NOT NULL THEN
    ALTER TABLE public.social_libraries RENAME TO "SocialLibraries";
  END IF;
  IF to_regclass('public."SocialImportStates"') IS NULL AND to_regclass('public.social_import_states') IS NOT NULL THEN
    ALTER TABLE public.social_import_states RENAME TO "SocialImportStates";
  END IF;
  IF to_regclass('public."SocialImportUsage"') IS NULL AND to_regclass('public.social_import_usage') IS NOT NULL THEN
    ALTER TABLE public.social_import_usage RENAME TO "SocialImportUsage";
  END IF;
  IF to_regclass('public."PublishJobs"') IS NULL AND to_regclass('public.publish_jobs') IS NOT NULL THEN
    ALTER TABLE public.publish_jobs RENAME TO "PublishJobs";
  END IF;
  IF to_regclass('public."Notifications"') IS NULL AND to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications RENAME TO "Notifications";
  END IF;
END $$;

