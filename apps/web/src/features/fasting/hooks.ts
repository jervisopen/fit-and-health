import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";

export const fastingKeys = { status: ["fasting", "status"] as const, history: ["fasting", "history"] as const };

export const HISTORY_DAYS = 35;

/** Status refreshes every minute and exactly when the current phase is due to flip. */
export function useFastingStatus() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: fastingKeys.status, queryFn: api.fastingStatus, refetchInterval: 60_000 });
  const boundary = query.data?.fast?.targetEndAt ?? query.data?.eating?.nextFastAt ?? null;
  useEffect(() => {
    if (!boundary) return;
    const wait = boundary - Date.now() + 1500;
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const t = window.setTimeout(() => qc.invalidateQueries({ queryKey: ["fasting"] }), wait);
    return () => window.clearTimeout(t);
  }, [boundary, qc]);
  return query;
}

export function useFastingHistory() {
  return useQuery({
    queryKey: fastingKeys.history,
    queryFn: () => api.fastingHistory(Date.now() - HISTORY_DAYS * 86_400_000),
  });
}

/** Mutations refresh both status and history. */
export function useFastingMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["fasting"] }) });
}

/** Re-render every `ms` for live timers. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** <input type="datetime-local"> value for an instant, in the browser's zone. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number {
  return new Date(v).getTime();
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** "8:00 PM" today/tomorrow-ish times, "Thu 8:00 PM" otherwise. */
export function clockTime(ms: number, now = Date.now()): string {
  return Math.abs(ms - now) < 20 * 3_600_000 ? timeFmt.format(ms) : dayTimeFmt.format(ms);
}
