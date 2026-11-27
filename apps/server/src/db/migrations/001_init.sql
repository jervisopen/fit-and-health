-- 001_init: food master, diary, fasting and snap tables.
-- Food database, diary logs and settings.
-- Food ids are stable text ids ("ifct:A019", "indb:ASC001", "off:<barcode>", "custom:<uuid>")
-- so rebuilding the food database never breaks diary references.

-- ── Foods, their names and their household measures ───────────────────────────────────────
CREATE TABLE foods (
  id                TEXT PRIMARY KEY,
  source            TEXT NOT NULL CHECK (source IN ('ifct','indb','off','custom')),
  source_ref        TEXT NOT NULL,
  name              TEXT NOT NULL,             -- display name
  brand             TEXT,
  category          TEXT,
  barcode           TEXT,
  is_veg            INTEGER,                   -- 1 veg, 0 non-veg, NULL unknown
  rank              REAL NOT NULL DEFAULT 0,   -- static popularity/quality prior (higher first)
  rel_breakfast     REAL NOT NULL DEFAULT 0,
  rel_lunch         REAL NOT NULL DEFAULT 0,
  rel_snack         REAL NOT NULL DEFAULT 0,
  rel_dinner        REAL NOT NULL DEFAULT 0,
  default_measure_id TEXT,
  density_g_per_ml  REAL,
  image_url         TEXT,
  data_quality      TEXT,                      -- NULL = ok; e.g. 'suspect_frying_oil' (INDB counts all frying oil)
  -- nutrients per 100 g (see packages/shared/src/nutrients.ts)
  energy_kcal REAL, protein_g REAL, carbs_g REAL, fat_g REAL, fibre_g REAL, sugar_g REAL,
  sat_fat_g REAL, trans_fat_g REAL, cholesterol_mg REAL, sodium_mg REAL, potassium_mg REAL,
  calcium_mg REAL, iron_mg REAL, magnesium_mg REAL, zinc_mg REAL, vit_a_ug REAL, vit_c_mg REAL,
  vit_d_ug REAL, vit_b6_mg REAL, vit_b12_ug REAL, folate_ug REAL, beta_carotene_ug REAL,
  omega3_g REAL, omega6_g REAL,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at        INTEGER
);
CREATE INDEX idx_foods_source ON foods(source);
CREATE UNIQUE INDEX idx_foods_barcode ON foods(barcode) WHERE barcode IS NOT NULL;

-- Many names per food: display name, local-language names, aliases.
CREATE TABLE food_names (
  id          INTEGER PRIMARY KEY,
  food_id     TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'en',
  is_primary  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_food_names_food ON food_names(food_id);

-- Word/prefix search and trigram (typo / spelling-variant) search over food_names.
CREATE VIRTUAL TABLE food_names_fts USING fts5(
  name, content='food_names', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);
CREATE VIRTUAL TABLE food_names_tri USING fts5(
  name, content='food_names', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER food_names_ai AFTER INSERT ON food_names BEGIN
  INSERT INTO food_names_fts(rowid, name) VALUES (new.id, new.name);
  INSERT INTO food_names_tri(rowid, name) VALUES (new.id, new.name);
END;
CREATE TRIGGER food_names_ad AFTER DELETE ON food_names BEGIN
  INSERT INTO food_names_fts(food_names_fts, rowid, name) VALUES ('delete', old.id, old.name);
  INSERT INTO food_names_tri(food_names_tri, rowid, name) VALUES ('delete', old.id, old.name);
END;
CREATE TRIGGER food_names_au AFTER UPDATE ON food_names BEGIN
  INSERT INTO food_names_fts(food_names_fts, rowid, name) VALUES ('delete', old.id, old.name);
  INSERT INTO food_names_tri(food_names_tri, rowid, name) VALUES ('delete', old.id, old.name);
  INSERT INTO food_names_fts(rowid, name) VALUES (new.id, new.name);
  INSERT INTO food_names_tri(rowid, name) VALUES (new.id, new.name);
END;

-- Serving units. food_id NULL = generic unit usable by any food
-- (g always; ml/tsp/cup/katori… only when the food has a density).
CREATE TABLE food_measures (
  id            TEXT PRIMARY KEY,
  food_id       TEXT REFERENCES foods(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                 -- "bowl", "piece", "katori", "g"
  weight_g      REAL,                          -- grams per 1 unit (food-specific)
  volume_ml     REAL,                          -- ml per 1 unit (generic volume units)
  rank          INTEGER NOT NULL DEFAULT 100,  -- lower first
  is_estimated  INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL,                 -- 'indb' | 'off' | 'seed' | 'custom'
  CHECK (weight_g IS NOT NULL OR volume_ml IS NOT NULL)
);
CREATE INDEX idx_food_measures_food ON food_measures(food_id);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- ── Diary (nutrients are snapshotted at log time) ───────────────────────────────────────────
CREATE TABLE food_logs (
  id            TEXT PRIMARY KEY,
  diary_date    TEXT NOT NULL,                 -- YYYY-MM-DD (local)
  meal_type     TEXT NOT NULL CHECK (meal_type IN ('B','SM','L','S','D')),
  food_id       TEXT,                          -- no FK: logs survive food DB rebuilds
  food_name     TEXT NOT NULL,
  measure_id    TEXT,
  measure_name  TEXT NOT NULL,
  quantity      REAL NOT NULL,
  weight_g      REAL NOT NULL,
  energy_kcal REAL, protein_g REAL, carbs_g REAL, fat_g REAL, fibre_g REAL, sugar_g REAL,
  sat_fat_g REAL, trans_fat_g REAL, cholesterol_mg REAL, sodium_mg REAL, potassium_mg REAL,
  calcium_mg REAL, iron_mg REAL, magnesium_mg REAL, zinc_mg REAL, vit_a_ug REAL, vit_c_mg REAL,
  vit_d_ug REAL, vit_b6_mg REAL, vit_b12_ug REAL, folate_ug REAL, beta_carotene_ug REAL,
  omega3_g REAL, omega6_g REAL,
  source        TEXT NOT NULL DEFAULT 'search'
                CHECK (source IN ('search','recent','my_meal','custom','barcode','snap','quick_add')),
  snap_image_id TEXT,
  consumed_at   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at    INTEGER
);
CREATE INDEX idx_food_logs_date ON food_logs(diary_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_food_logs_food ON food_logs(food_id);

-- Per-meal settings, effective from a date onward (≈ UserMealPreferencesNew).
CREATE TABLE meal_settings (
  effective_from TEXT NOT NULL,
  meal_type      TEXT NOT NULL CHECK (meal_type IN ('B','SM','L','S','D')),
  display_name   TEXT NOT NULL,
  time_min       INTEGER NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  calories_pct   REAL NOT NULL,
  PRIMARY KEY (effective_from, meal_type)
);

-- Daily goals, effective from a date onward (≈ user_budgets + macro budgets).
CREATE TABLE goals (
  effective_from TEXT PRIMARY KEY,
  calories       REAL NOT NULL,
  protein_g      REAL NOT NULL,
  carbs_g        REAL NOT NULL,
  fat_g          REAL NOT NULL,
  fibre_g        REAL NOT NULL,
  micro_targets  TEXT                           -- JSON {nutrient_key: target}
);

-- Saved meals (≈ my_meals).
CREATE TABLE my_meals (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  meal_type   TEXT,
  image_url   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at  INTEGER
);
CREATE TABLE my_meal_items (
  id          TEXT PRIMARY KEY,
  my_meal_id  TEXT NOT NULL REFERENCES my_meals(id) ON DELETE CASCADE,
  food_id     TEXT NOT NULL,
  measure_id  TEXT,
  quantity    REAL NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0
);

-- ── Intermittent fasting (≈ UserFastingPlans / UserCustomFastingLogs) ───────────────────────
CREATE TABLE fasting_plans (
  id                    TEXT PRIMARY KEY,
  preset_key            TEXT,
  mode                  TEXT NOT NULL DEFAULT 'schedule' CHECK (mode IN ('schedule','manual')),
  fasting_hours         REAL NOT NULL,
  eating_hours          REAL NOT NULL,
  fasting_starts_at_min INTEGER,               -- minute of day; NULL in manual mode
  fasting_ends_at_min   INTEGER,
  start_date            TEXT NOT NULL,
  end_date              TEXT,
  reminders             TEXT                    -- JSON
);
CREATE TABLE fasting_logs (
  id            TEXT PRIMARY KEY,
  plan_id       TEXT REFERENCES fasting_plans(id) ON DELETE SET NULL,
  started_at    INTEGER NOT NULL,              -- epoch seconds
  ended_at      INTEGER,                       -- NULL while fasting
  target_hours  REAL NOT NULL,
  is_goal_met   INTEGER,
  origin        TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('auto','manual')),
  note          TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at    INTEGER
);
CREATE INDEX idx_fasting_logs_started ON fasting_logs(started_at) WHERE deleted_at IS NULL;

-- ── Snap (≈ SnapDetectedImage + detection results) ──────────────────────────────────────────
CREATE TABLE snap_images (
  id            TEXT PRIMARY KEY,
  file_path     TEXT NOT NULL,
  thumb_path    TEXT,
  sha256        TEXT NOT NULL,
  captured_at   INTEGER NOT NULL,
  meal_type     TEXT CHECK (meal_type IN ('B','SM','L','S','D')),
  status        TEXT NOT NULL DEFAULT 'uploaded'
                CHECK (status IN ('uploaded','processing','detected','no_food','failed','tracked')),
  provider      TEXT,
  model         TEXT,
  raw_response  TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE snap_detections (
  id               TEXT PRIMARY KEY,
  image_id         TEXT NOT NULL REFERENCES snap_images(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  matched_food_id  TEXT,
  confidence       REAL,
  bbox_x REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,   -- normalized 0..1
  est_measure_id   TEXT,
  est_quantity     REAL,
  est_weight_g     REAL,
  selected         INTEGER NOT NULL DEFAULT 1,
  food_log_id      TEXT
);
CREATE INDEX idx_snap_detections_image ON snap_detections(image_id);
