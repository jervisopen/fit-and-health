import type {
  CreateLogBody, CustomFoodBody, DaySummaryDTO, DiaryDayDTO, FoodDetailDTO, FoodLogDTO, FoodSearchResultDTO,
  FoodSummaryDTO, MealSettingDTO, RecentFoodDTO, SettingsDTO, SnapImageDTO, SnapTrackBody, UpdateLogBody, VisionStatusDTO,
} from "../../../../packages/shared/src/api.ts";
import type { MacroGoals, Profile } from "../../../../packages/shared/src/goals.ts";
import type { MealTypeCode } from "../../../../packages/shared/src/meals.ts";
import type { FastingLogDTO, FastingMode, FastingStatusDTO } from "../../../../packages/shared/src/fasting.ts";
import type {
  Activity, AddWaterBody, AddWorkoutBody, SetSleepBody, SetWeightBody, SleepDTO, TrackerDayDTO, TrackerHistoryDayDTO,
  TrackerSettings, TrackerSettingsPatch, UpdateWorkoutBody, WaterEntryDTO, WeightEntryDTO, WorkoutDTO,
} from "../../../../packages/shared/src/trackers.ts";
import { apiFetch } from "./transport.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type HealthDTO = { ok: boolean; mode: "server" | "local"; foodDbVersion: string | null; foods: number };
export type VisionSettingsDTO = {
  saved: { provider: string; model: string; baseURL: string; effort: string; hasKey: boolean } | null;
  status: VisionStatusDTO;
};
export type VisionSettingsBody = { provider: string; apiKey?: string; model?: string; baseURL?: string; effort?: string };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export const api = {
  searchFoods: (query: string, meal?: MealTypeCode) => request<FoodSearchResultDTO[]>("GET", `/foods/search${q({ q: query, meal })}`),
  recentFoods: (meal?: MealTypeCode) => request<RecentFoodDTO[]>("GET", `/foods/recent${q({ meal })}`),
  food: (id: string) => request<FoodDetailDTO>("GET", `/foods/${encodeURIComponent(id)}`),
  barcode: (code: string) => request<FoodDetailDTO>("GET", `/foods/barcode/${encodeURIComponent(code)}`),
  customFoods: () => request<FoodSummaryDTO[]>("GET", "/foods/custom"),
  createCustomFood: (b: CustomFoodBody) => request<FoodDetailDTO>("POST", "/foods/custom", b),
  updateCustomFood: (id: string, b: CustomFoodBody) => request<FoodDetailDTO>("PUT", `/foods/custom/${encodeURIComponent(id)}`, b),
  deleteCustomFood: (id: string) => request<void>("DELETE", `/foods/custom/${encodeURIComponent(id)}`),

  diary: (date: string) => request<DiaryDayDTO>("GET", `/diary/${date}`),
  summary: (from: string, to: string) => request<DaySummaryDTO[]>("GET", `/diary/summary${q({ from, to })}`),
  createLog: (b: CreateLogBody) => request<FoodLogDTO>("POST", "/logs", b),
  updateLog: (id: string, b: UpdateLogBody) => request<FoodLogDTO>("PATCH", `/logs/${id}`, b),
  deleteLog: (id: string) => request<void>("DELETE", `/logs/${id}`),
  copyMeal: (from: { date: string; mealType: MealTypeCode }, to: { date: string; mealType: MealTypeCode }) =>
    request<FoodLogDTO[]>("POST", "/logs/copy-meal", { from, to }),

  fastingStatus: () => request<FastingStatusDTO>("GET", "/fasting/status"),
  setFastingPlan: (p: { presetKey: string; mode: FastingMode; fastingHours: number; startsAtMin: number | null; timezone: string }) =>
    request<FastingStatusDTO>("PUT", "/fasting/plan", p),
  endFastingPlan: () => request<FastingStatusDTO>("DELETE", "/fasting/plan"),
  startFast: (startedAt?: number) => request<FastingStatusDTO>("POST", "/fasting/start", { startedAt }),
  endFast: (b: { endedAt?: number; startedAt?: number }) => request<{ status: FastingStatusDTO; log: FastingLogDTO }>("POST", "/fasting/end", b),
  fastingHistory: (from: number, to?: number) => request<FastingLogDTO[]>("GET", `/fasting/history${q({ from, to })}`),
  updateFast: (id: string, b: { startedAt?: number; endedAt?: number; note?: string | null }) =>
    request<FastingLogDTO>("PATCH", `/fasting/logs/${id}`, b),
  deleteFast: (id: string) => request<void>("DELETE", `/fasting/logs/${id}`),

  snapStatus: () => request<VisionStatusDTO>("GET", "/snap/status"),
  snaps: () => request<SnapImageDTO[]>("GET", "/snap?limit=24"),
  snap: (id: string) => request<SnapImageDTO>("GET", `/snap/${id}`),
  uploadSnap: async (image: Blob, meta: { mealType?: MealTypeCode; mealName?: string; capturedAt?: number }) => {
    const form = new FormData();
    form.set("image", image, "meal.jpg");
    if (meta.mealType) form.set("mealType", meta.mealType);
    if (meta.mealName) form.set("mealName", meta.mealName);
    if (meta.capturedAt) form.set("capturedAt", String(meta.capturedAt));
    const res = await apiFetch("/snap", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Upload failed (${res.status})`);
    return data as SnapImageDTO;
  },
  retrySnap: (id: string) => request<SnapImageDTO>("POST", `/snap/${id}/retry`),
  trackSnap: (id: string, b: SnapTrackBody) => request<FoodLogDTO[]>("POST", `/snap/${id}/track`, b),
  deleteSnap: (id: string) => request<void>("DELETE", `/snap/${id}`),

  settings: (date: string) => request<SettingsDTO>("GET", `/settings${q({ date })}`),
  saveGoals: (goals: MacroGoals, effectiveFrom: string) => request<SettingsDTO>("PUT", "/settings/goals", { ...goals, effectiveFrom }),
  saveMeals: (meals: MealSettingDTO[], effectiveFrom: string) => request<SettingsDTO>("PUT", "/settings/meals", { meals, effectiveFrom }),
  saveProfile: (p: Profile) => request<SettingsDTO>("PUT", "/settings/profile", p),

  trackerDay: (date: string) => request<TrackerDayDTO>("GET", `/trackers/${date}`),
  trackerHistory: (from: string, to: string) => request<TrackerHistoryDayDTO[]>("GET", `/trackers/history${q({ from, to })}`),
  trackerSettings: () => request<TrackerSettings>("GET", "/trackers/settings"),
  updateTrackerSettings: (b: TrackerSettingsPatch) => request<TrackerSettings>("PATCH", "/trackers/settings", b),
  addWater: (b: AddWaterBody) => request<WaterEntryDTO>("POST", "/water", b),
  deleteWater: (id: string) => request<void>("DELETE", `/water/${id}`),
  setWeight: (date: string, b: SetWeightBody) => request<WeightEntryDTO>("PUT", `/weight/${date}`, b),
  deleteWeight: (date: string) => request<void>("DELETE", `/weight/${date}`),
  activities: () => request<Activity[]>("GET", "/workouts/activities"),
  recentActivities: () => request<string[]>("GET", "/workouts/recent"),
  addWorkout: (b: AddWorkoutBody) => request<WorkoutDTO>("POST", "/workouts", b),
  updateWorkout: (id: string, b: UpdateWorkoutBody) => request<WorkoutDTO>("PATCH", `/workouts/${id}`, b),
  deleteWorkout: (id: string) => request<void>("DELETE", `/workouts/${id}`),
  setSleep: (date: string, b: SetSleepBody) => request<SleepDTO>("PUT", `/sleep/${date}`, b),
  deleteSleep: (date: string) => request<void>("DELETE", `/sleep/${date}`),

  health: () => request<HealthDTO>("GET", "/health"),
  visionSettings: () => request<VisionSettingsDTO>("GET", "/settings/vision"),
  saveVisionSettings: (b: VisionSettingsBody) => request<{ status: VisionStatusDTO }>("PUT", "/settings/vision", b),
  visionModels: (b: { provider: string; apiKey?: string; baseURL?: string }) =>
    request<{ models: { id: string; label: string }[] }>("POST", "/settings/vision/models", b),
  clearVisionSettings: () => request<{ status: VisionStatusDTO }>("DELETE", "/settings/vision"),

  /** Binary responses (photos, calendar file) as a Blob. */
  blob: async (path: string): Promise<Blob> => {
    const res = await apiFetch(path);
    if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`);
    return res.blob();
  },
};
