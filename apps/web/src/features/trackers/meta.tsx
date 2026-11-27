import type { ReactNode } from "react";
import { Droplet, Dumbbell, Footprints, GlassWater, HeartPulse, Moon, Pill, Scale, Wind } from "lucide-react";
import type { TrackerKind } from "../../../../../packages/shared/src/trackers.ts";

export const TRACKER_META: Record<TrackerKind, { title: string; icon: (size?: number) => ReactNode; color: string; soft: string; text: string }> = {
  water: { title: "Water", icon: (s = 20) => <GlassWater size={s} />, color: "var(--water)", soft: "bg-water-soft", text: "text-water" },
  weight: { title: "Weight", icon: (s = 20) => <Scale size={s} />, color: "var(--weight)", soft: "bg-weight-soft", text: "text-weight" },
  workout: { title: "Workout", icon: (s = 20) => <Dumbbell size={s} />, color: "var(--workout)", soft: "bg-workout-soft", text: "text-workout" },
  sleep: { title: "Sleep", icon: (s = 20) => <Moon size={s} />, color: "var(--sleep)", soft: "bg-sleep-soft", text: "text-sleep" },
  steps: { title: "Steps", icon: (s = 20) => <Footprints size={s} />, color: "var(--steps)", soft: "bg-steps-soft", text: "text-steps" },
  glucose: { title: "Blood glucose", icon: (s = 20) => <Droplet size={s} />, color: "var(--glucose)", soft: "bg-glucose-soft", text: "text-glucose" },
  medicine: { title: "Medicines", icon: (s = 20) => <Pill size={s} />, color: "var(--medicine)", soft: "bg-medicine-soft", text: "text-medicine" },
  heart: { title: "Heart rate", icon: (s = 20) => <HeartPulse size={s} />, color: "var(--heart)", soft: "bg-heart-soft", text: "text-heart" },
  breathing: { title: "Breathing rate", icon: (s = 20) => <Wind size={s} />, color: "var(--breathing)", soft: "bg-breathing-soft", text: "text-breathing" },
};

export type DailyKind = "water" | "weight" | "workout" | "steps" | "sleep";
export const DAILY_KINDS: DailyKind[] = ["water", "weight", "workout", "steps", "sleep"];
export const HEALTH_KINDS = ["glucose", "medicine", "heart", "breathing"] as const;

/** 435 → "7 h 15 m", 480 → "8 h", 45 → "45 m". */
export function hoursMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} m`;
  return m ? `${h} h ${m} m` : `${h} h`;
}

/** 1250 → "1.25 L", 2000 → "2 L". */
export function litres(ml: number): string {
  return `${Number((ml / 1000).toFixed(2))} L`;
}

export const glassesOf = (ml: number, glassMl: number) => Math.round((ml / glassMl) * 10) / 10;

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
export const dayLabel = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00`));

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
export const clock = (ms: number) => timeFmt.format(ms);
