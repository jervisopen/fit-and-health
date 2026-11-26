// Food record types live with the server's food writer; re-exported for the ingest scripts.
export type {
  DatasetSource as FoodSource, FoodNameRecord, FoodRecord, MeasureRecord,
} from "../../../apps/server/src/foods/write.ts";
