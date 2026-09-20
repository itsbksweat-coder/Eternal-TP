-- ============================================================
-- Eternal TP
-- Authoritative server-side timer
-- ============================================================

ALTER TABLE users
ADD COLUMN timer_started_at INTEGER;

-- Existing active users begin counting from migration time.
UPDATE users
SET timer_started_at = unixepoch()
WHERE paused = 0
  AND time_remaining > 0;
