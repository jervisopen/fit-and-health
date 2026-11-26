/**
 * Time-zone math without dependencies (Intl only), shared by server and browser.
 * All instants are epoch milliseconds; calendar dates are "YYYY-MM-DD" in a named IANA zone.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    dtf(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const part of dtf(tz).formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour!, minute: p.minute!, second: p.second! };
}

/** Offset of `tz` from UTC at instant `ms`, in ms (IST → +19 800 000). */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Instant of a wall-clock time (date + minutes after midnight) in `tz`. Handles DST shifts. */
export function zonedTimeToMs(dateIso: string, minuteOfDay: number, tz: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, 0, minuteOfDay);
  let ms = guess - tzOffsetMs(guess, tz);
  const corrected = guess - tzOffsetMs(ms, tz);
  if (corrected !== ms) ms = corrected;
  return ms;
}

/** Calendar date of an instant in `tz`. */
export function dateInZone(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return t.toISOString().slice(0, 10);
}

export const HOUR = 3_600_000;
export const MINUTE = 60_000;

/** "15h 30m", "45m", "2d 3h". */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / MINUTE));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** "15:30:07" style clock for a running timer. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
