/**
 * Meal slots, recovered from HealthifyMe's MealTypeInterface.MealType
 * (B, SM, L, S, D). Default times and calorie split are ours (not recovered from the APK).
 */
export const MEAL_TYPES = [
  { code: "B", name: "Breakfast", defaultTimeMin: 8 * 60, defaultPct: 25 },
  { code: "SM", name: "Morning Snack", defaultTimeMin: 11 * 60, defaultPct: 10 },
  { code: "L", name: "Lunch", defaultTimeMin: 13 * 60 + 30, defaultPct: 30 },
  { code: "S", name: "Evening Snack", defaultTimeMin: 17 * 60, defaultPct: 10 },
  { code: "D", name: "Dinner", defaultTimeMin: 20 * 60 + 30, defaultPct: 25 },
] as const;

export type MealTypeCode = (typeof MEAL_TYPES)[number]["code"];
export const MEAL_CODES = MEAL_TYPES.map((m) => m.code) as MealTypeCode[];

export function isMealType(v: unknown): v is MealTypeCode {
  return typeof v === "string" && (MEAL_CODES as string[]).includes(v);
}

/** The meal slot whose time is closest to `minuteOfDay` (HealthifyMe's getClosestMealType). */
export function closestMealType(minuteOfDay: number, slots: readonly { code: MealTypeCode; timeMin: number }[] = MEAL_TYPES.map((m) => ({ code: m.code, timeMin: m.defaultTimeMin }))): MealTypeCode {
  let best = slots[0]!;
  for (const s of slots) if (Math.abs(s.timeMin - minuteOfDay) < Math.abs(best.timeMin - minuteOfDay)) best = s;
  return best.code;
}
