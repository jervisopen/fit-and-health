-- Water, weight, workout and sleep trackers. Dates are the user's local "YYYY-MM-DD".

CREATE TABLE water_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  ml INTEGER NOT NULL CHECK (ml > 0 AND ml <= 5000),
  logged_at INTEGER NOT NULL
);
CREATE INDEX water_logs_date ON water_logs (date);

-- One weigh-in per day (the latest one entered that day wins).
CREATE TABLE weight_logs (
  date TEXT PRIMARY KEY,
  kg REAL NOT NULL CHECK (kg >= 20 AND kg <= 400),
  note TEXT,
  logged_at INTEGER NOT NULL
);

CREATE TABLE workout_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  activity_key TEXT NOT NULL,
  name TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  met REAL,                 -- NULL for a custom activity with calories typed in
  kcal REAL NOT NULL,       -- total burned during the activity
  net_kcal REAL NOT NULL,   -- above resting: what can be added to the food budget
  note TEXT,
  logged_at INTEGER NOT NULL
);
CREATE INDEX workout_logs_date ON workout_logs (date);

-- One night per wake-up date.
CREATE TABLE sleep_logs (
  date TEXT PRIMARY KEY,
  bed_at INTEGER NOT NULL,
  wake_at INTEGER NOT NULL,
  quality INTEGER CHECK (quality BETWEEN 1 AND 5),
  note TEXT,
  CHECK (wake_at > bed_at AND wake_at - bed_at <= 86400000)
);
