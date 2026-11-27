/** Request/response shapes shared by the server and the web app. */
import type { NutrientValues } from "./nutrients.ts";
import type { MealTypeCode } from "./meals.ts";
import type { MacroGoals, Profile } from "./goals.ts";

export type FoodSource = "ifct" | "indb" | "off" | "custom";

export type MeasureDTO = {
  id: string;
  name: string;
  /** Grams in one unit of this measure. */
  weightG: number;
  isEstimated: boolean;
  /** "food" = specific to this food; "generic" = g / katori / cup… via density. */
  kind: "food" | "generic";
};

export type FoodSummaryDTO = {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  source: FoodSource | string;
  isVeg: boolean | null;
  kcalPer100g: number | null;
  defaultMeasure: { id: string; name: string; weightG: number } | null;
  defaultQuantity: number;
  kcalPerDefault: number | null;
  dataQuality: string | null;
};

export type FoodSearchResultDTO = FoodSummaryDTO & { matchedName: string; score: number };

export type RecentFoodDTO = FoodSummaryDTO & {
  lastMeasureId: string | null;
  lastQuantity: number;
  timesLogged: number;
};

export type FoodDetailDTO = FoodSummaryDTO & {
  per100g: NutrientValues;
  measures: MeasureDTO[];
  defaultMeasureId: string;
  barcode: string | null;
  imageUrl: string | null;
};

export type LogSource = "search" | "recent" | "my_meal" | "custom" | "barcode" | "snap" | "quick_add";

export type CreateLogBody = {
  date: string;
  mealType: MealTypeCode;
  foodId: string;
  measureId: string;
  quantity: number;
  source?: LogSource;
};

export type UpdateLogBody = Partial<{ quantity: number; measureId: string; mealType: MealTypeCode; date: string }>;

export type FoodLogDTO = {
  id: string;
  date: string;
  mealType: MealTypeCode;
  foodId: string | null;
  foodName: string;
  measureId: string | null;
  measureName: string;
  quantity: number;
  weightG: number;
  nutrients: NutrientValues;
  source: LogSource;
  snapImageId: string | null;
  dataQuality: string | null;
  createdAt: number;
};

export type MealDTO = {
  code: MealTypeCode;
  name: string;
  timeMin: number;
  enabled: boolean;
  budgetKcal: number;
  totals: NutrientValues;
  logs: FoodLogDTO[];
};

export type DiaryDayDTO = {
  date: string;
  goals: MacroGoals;
  goalsAreDefault: boolean;
  meals: MealDTO[];
  totals: NutrientValues;
};

export type DaySummaryDTO = { date: string; kcal: number; logs: number };

export type MealSettingDTO = {
  code: MealTypeCode;
  displayName: string;
  timeMin: number;
  enabled: boolean;
  caloriesPct: number;
};

export type SettingsDTO = {
  goals: MacroGoals;
  goalsAreDefault: boolean;
  meals: MealSettingDTO[];
  profile: Profile | null;
};

export type CustomFoodBody = {
  name: string;
  brand?: string;
  isVeg?: boolean;
  servingName: string;
  servingWeightG: number;
  /** Values for one serving; converted to per 100 g on save. */
  perServing: NutrientValues;
};

export type SnapDetectionDTO = {
  id: string;
  label: string;
  localName: string | null;
  confidence: number | null;
  /** Fractions of the image, origin top-left. */
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** Best database match (null when nothing matched). */
  food: FoodSummaryDTO | null;
  measureId: string | null;
  quantity: number | null;
  weightG: number | null;
  alternatives: FoodSummaryDTO[];
  selected: boolean;
  foodLogId: string | null;
};

export type SnapStatus = "uploaded" | "processing" | "detected" | "no_food" | "failed" | "tracked";

export type SnapImageDTO = {
  id: string;
  status: SnapStatus;
  capturedAt: number;
  mealType: MealTypeCode | null;
  provider: string | null;
  model: string | null;
  notes: string | null;
  error: string | null;
  imageUrl: string;
  detections: SnapDetectionDTO[];
};

export type SnapTrackBody = {
  date: string;
  mealType: MealTypeCode;
  items: { detectionId?: string; foodId: string; measureId: string; quantity: number }[];
};

export type VisionStatusDTO = { configured: true; provider: string; model: string } | { configured: false; reason: string };

export type ApiError = { error: string; details?: unknown };
