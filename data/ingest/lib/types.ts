import type { NutrientValues } from "../../../packages/shared/src/nutrients.ts";

export type FoodSource = "ifct" | "indb" | "off";

export type FoodNameRecord = { name: string; lang: string; isPrimary: boolean };

export type MeasureRecord = {
  id: string;
  name: string;
  weightG: number;
  rank: number;
  isEstimated: boolean;
  source: "indb" | "off" | "seed";
};

export type FoodRecord = {
  id: string;
  source: FoodSource;
  sourceRef: string;
  name: string;
  brand?: string;
  category?: string;
  barcode?: string;
  isVeg?: boolean;
  /** Static prior used by search ranking; higher is better. */
  rank: number;
  relevance: { breakfast: number; lunch: number; snack: number; dinner: number };
  densityGPerMl?: number;
  imageUrl?: string;
  /** Known issue with the source values, surfaced in the UI. */
  dataQuality?: "suspect_frying_oil";
  nutrients: NutrientValues;
  names: FoodNameRecord[];
  measures: MeasureRecord[];
  defaultMeasureId: string;
};
