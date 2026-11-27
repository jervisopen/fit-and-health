-- Steps walked per day, typed in by the user (the day's total).
CREATE TABLE steps_logs (
  date TEXT PRIMARY KEY,
  steps INTEGER NOT NULL CHECK (steps >= 0 AND steps <= 200000),
  logged_at INTEGER NOT NULL
);
