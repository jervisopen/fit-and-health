/**
 * One-screen goal setup: daily calorie and macro targets from a short profile.
 * BMR: Mifflin-St Jeor. Fibre: 14 g per 1,000 kcal (Dietary Guidelines; ICMR-NIN recommends ~30 g / 2,000 kcal).
 * General guidance only, not medical advice.
 */
export type Sex = "female" | "male";
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalDirection = "lose" | "maintain" | "gain";

export type Profile = {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: GoalDirection;
};

export type MacroGoals = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
};

export const ACTIVITY_FACTORS: Record<Activity, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<Activity, string> = {
  sedentary: "Mostly sitting",
  light: "Light activity (1–3 days/week)",
  moderate: "Moderate (3–5 days/week)",
  active: "Active (6–7 days/week)",
  very_active: "Very active / physical job",
};

/** ±500 kcal/day ≈ 0.5 kg/week. */
const GOAL_DELTA: Record<GoalDirection, number> = { lose: -500, maintain: 0, gain: 300 };

export function bmr(p: Pick<Profile, "sex" | "age" | "heightCm" | "weightKg">): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return p.sex === "male" ? base + 5 : base - 161;
}

/** Split calories into macros by energy share (protein 4, carbs 4, fat 9 kcal/g). */
export function macrosFor(calories: number, split = { protein: 0.2, carbs: 0.5, fat: 0.3 }): MacroGoals {
  return {
    calories: Math.round(calories),
    protein_g: Math.round((calories * split.protein) / 4),
    carbs_g: Math.round((calories * split.carbs) / 4),
    fat_g: Math.round((calories * split.fat) / 9),
    fibre_g: Math.round((calories / 1000) * 14),
  };
}

export function goalsFromProfile(p: Profile): MacroGoals {
  const tdee = bmr(p) * ACTIVITY_FACTORS[p.activity];
  // Never suggest below 1,200 kcal (women) / 1,500 kcal (men) without supervision.
  const floor = p.sex === "male" ? 1500 : 1200;
  const target = Math.max(floor, Math.round((tdee + GOAL_DELTA[p.goal]) / 10) * 10);
  // Slightly more protein when losing weight.
  const split = p.goal === "lose" ? { protein: 0.25, carbs: 0.45, fat: 0.3 } : { protein: 0.2, carbs: 0.5, fat: 0.3 };
  return macrosFor(target, split);
}

export const DEFAULT_GOALS: MacroGoals = macrosFor(2000);
