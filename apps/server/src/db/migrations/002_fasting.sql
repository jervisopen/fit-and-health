-- 002_fasting: what the schedule-driven fasting tracker needs on top of 001.
-- Plans are anchored to the user's time zone so "fast from 8 PM" means 8 PM where they live,
-- even when the server runs in UTC (e.g. Docker).
ALTER TABLE fasting_plans ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE fasting_plans ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;   -- epoch s; schedule auto-tracks from here
ALTER TABLE fasting_plans ADD COLUMN ended_at INTEGER;                         -- epoch s; NULL = active
UPDATE fasting_plans SET created_at = CAST(strftime('%s', start_date) AS INTEGER) WHERE created_at = 0;

-- When the fast is meant to end (manual: start + target; schedule: end of the scheduled window).
ALTER TABLE fasting_logs ADD COLUMN target_end_at INTEGER;
UPDATE fasting_logs SET target_end_at = started_at + CAST(target_hours * 3600 AS INTEGER) WHERE target_end_at IS NULL;

-- Overlap checks during auto-tracking include deleted rows (a deleted auto fast must stay deleted).
CREATE INDEX idx_fasting_logs_span ON fasting_logs(started_at, ended_at);
CREATE INDEX idx_fasting_plans_active ON fasting_plans(ended_at);
