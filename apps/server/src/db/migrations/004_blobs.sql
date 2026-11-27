-- 004_blobs: binary storage inside the database (meal photos), so the app needs no file system.
-- Works the same on the Node server and in the browser (SQLite in OPFS).
CREATE TABLE blobs (
  key        TEXT PRIMARY KEY,
  bytes      BLOB NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
