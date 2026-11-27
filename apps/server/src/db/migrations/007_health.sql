-- Blood glucose, heart and breathing rate, medicines. Dates are the user's local "YYYY-MM-DD".

CREATE TABLE glucose_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  measured_at INTEGER NOT NULL,
  mgdl REAL NOT NULL CHECK (mgdl >= 10 AND mgdl <= 1000),   -- always stored in mg/dL
  tag TEXT NOT NULL CHECK (tag IN ('fasting', 'before_meal', 'after_meal', 'random', 'bedtime')),
  meal_type TEXT CHECK (meal_type IN ('B', 'SM', 'L', 'S', 'D')),
  note TEXT
);
CREATE INDEX glucose_logs_date ON glucose_logs (date);

CREATE TABLE vital_logs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('heart', 'breathing')),
  date TEXT NOT NULL,
  measured_at INTEGER NOT NULL,
  value REAL NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('resting', 'after_activity', 'other')),
  note TEXT
);
CREATE INDEX vital_logs_kind_date ON vital_logs (kind, date);

CREATE TABLE medicines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dose TEXT,
  times TEXT NOT NULL DEFAULT '[]',   -- JSON array of minutes after midnight
  days TEXT,                          -- JSON array of weekdays (0 = Sunday); NULL = every day
  as_needed INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  end_date TEXT,
  notes TEXT,
  timezone TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER                  -- soft delete keeps the dose history meaningful
);

CREATE TABLE medicine_doses (
  id TEXT PRIMARY KEY,
  medicine_id TEXT NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time_min INTEGER,                   -- NULL for an as-needed dose
  status TEXT NOT NULL CHECK (status IN ('taken', 'skipped')),
  recorded_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX medicine_doses_slot ON medicine_doses (medicine_id, date, time_min) WHERE time_min IS NOT NULL;
CREATE INDEX medicine_doses_date ON medicine_doses (date);
