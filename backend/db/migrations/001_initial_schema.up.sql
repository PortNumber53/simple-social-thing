-- Users table
CREATE TABLE IF NOT EXISTS public."Users" (
    id TEXT PRIMARY KEY,
    email TEXT,
    name TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SocialConnections table
CREATE TABLE IF NOT EXISTS public."SocialConnections" (
    id TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES public."Users"(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    email TEXT,
    name TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE("userId", provider)
);

-- Teams table
CREATE TABLE IF NOT EXISTS public."Teams" (
    id TEXT PRIMARY KEY,
    "owner_id" TEXT REFERENCES public."Users"(id) ON DELETE CASCADE,
    "current_tier" TEXT,
    "posts_created_today" INTEGER DEFAULT 0,
    "usage_reset_date" TIMESTAMP,
    "ig_llat" TEXT,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TeamMembers table
CREATE TABLE IF NOT EXISTS public."TeamMembers" (
    id TEXT PRIMARY KEY,
    "team_id" TEXT REFERENCES public."Teams"(id) ON DELETE CASCADE,
    "user_id" TEXT REFERENCES public."Users"(id) ON DELETE CASCADE,
    role TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE("team_id", "user_id")
);

-- Posts table
CREATE TABLE IF NOT EXISTS public."Posts" (
    id TEXT PRIMARY KEY,
    "teamId" TEXT REFERENCES public."Teams"(id) ON DELETE CASCADE,
    "userId" TEXT REFERENCES public."Users"(id) ON DELETE CASCADE,
    content TEXT,
    status TEXT DEFAULT 'draft',
    "scheduledFor" TIMESTAMP WITH TIME ZONE,
    "publishedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_social_connections_user_id ON public."SocialConnections"("userId");
CREATE INDEX IF NOT EXISTS idx_social_connections_provider ON public."SocialConnections"(provider, "providerId");
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON public."TeamMembers"("team_id");
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON public."TeamMembers"("user_id");
CREATE INDEX IF NOT EXISTS idx_posts_team_id ON public."Posts"("teamId");
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON public."Posts"("userId");
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON public."Posts"("scheduledFor") WHERE status = 'scheduled';
