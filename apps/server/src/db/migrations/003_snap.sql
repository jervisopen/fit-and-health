-- 003_snap: details the Snap confirmation screen shows.
ALTER TABLE snap_detections ADD COLUMN local_name TEXT;
ALTER TABLE snap_detections ADD COLUMN portion_unit TEXT;
ALTER TABLE snap_detections ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE snap_detections ADD COLUMN alternatives TEXT;   -- JSON array of food ids
ALTER TABLE snap_images ADD COLUMN mime TEXT NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE snap_images ADD COLUMN notes TEXT;
CREATE INDEX idx_snap_images_created ON snap_images(created_at);
CREATE INDEX idx_food_logs_snap ON food_logs(snap_image_id) WHERE snap_image_id IS NOT NULL;
