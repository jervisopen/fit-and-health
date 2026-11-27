-- migrate:foreign-keys-off
-- Allow 'usda' (USDA FoodData Central, public domain) as a food source: Indian staples and the
-- SR Legacy foods. SQLite can't change a CHECK constraint, so the table is rebuilt with SQLite's
-- documented procedure (new table, copy, drop, rename). Same columns, in the same order.

CREATE TABLE foods_new (
  id                TEXT PRIMARY KEY,
  source            TEXT NOT NULL CHECK (source IN ('ifct','indb','off','custom','usda')),
  source_ref        TEXT NOT NULL,
  name              TEXT NOT NULL,
  brand             TEXT,
  category          TEXT,
  barcode           TEXT,
  is_veg            INTEGER,
  rank              REAL NOT NULL DEFAULT 0,
  rel_breakfast     REAL NOT NULL DEFAULT 0,
  rel_lunch         REAL NOT NULL DEFAULT 0,
  rel_snack         REAL NOT NULL DEFAULT 0,
  rel_dinner        REAL NOT NULL DEFAULT 0,
  default_measure_id TEXT,
  density_g_per_ml  REAL,
  image_url         TEXT,
  data_quality      TEXT,
  energy_kcal REAL, protein_g REAL, carbs_g REAL, fat_g REAL, fibre_g REAL, sugar_g REAL,
  sat_fat_g REAL, trans_fat_g REAL, cholesterol_mg REAL, sodium_mg REAL, potassium_mg REAL,
  calcium_mg REAL, iron_mg REAL, magnesium_mg REAL, zinc_mg REAL, vit_a_ug REAL, vit_c_mg REAL,
  vit_d_ug REAL, vit_b6_mg REAL, vit_b12_ug REAL, folate_ug REAL, beta_carotene_ug REAL,
  omega3_g REAL, omega6_g REAL,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at        INTEGER
);

INSERT INTO foods_new SELECT * FROM foods;
DROP TABLE foods;
ALTER TABLE foods_new RENAME TO foods;

CREATE INDEX idx_foods_source ON foods(source);
CREATE UNIQUE INDEX idx_foods_barcode ON foods(barcode) WHERE barcode IS NOT NULL;
