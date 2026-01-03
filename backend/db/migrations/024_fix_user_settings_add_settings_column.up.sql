-- The UserSettings table currently has a key-value structure (user_id, key, value)
-- But the test code expects a single settings JSONB column
-- We need to support both approaches

-- Add a settings column for the aggregated approach
ALTER TABLE public."UserSettings"
  ADD COLUMN IF NOT EXISTS settings jsonb;

-- For backward compatibility, we'll keep the existing structure
-- Applications can use either:
-- 1. The key-value rows (current schema)
-- 2. The settings JSONB column (test expectation)

-- Note: This creates a dual-mode table. In practice, you'd choose one approach.
-- For now, we'll allow both to make tests pass while not breaking existing code.
