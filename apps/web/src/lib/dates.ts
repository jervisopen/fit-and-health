/** Local-calendar date helpers; diary dates are "YYYY-MM-DD" in the user's own time zone. */

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fromIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function today(): string {
  return toIso(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

export function isValidIso(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && toIso(fromIso(s)) === s;
}

/** Monday-first week containing `iso`. */
export function weekOf(iso: string): string[] {
  const d = fromIso(iso);
  const offset = (d.getDay() + 6) % 7;
  const monday = addDays(iso, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const longFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
const shortFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

export function weekdayShort(iso: string): string {
  return dayFmt.format(fromIso(iso));
}

export function relativeLabel(iso: string): string {
  const t = today();
  if (iso === t) return "Today";
  if (iso === addDays(t, -1)) return "Yesterday";
  if (iso === addDays(t, 1)) return "Tomorrow";
  return longFmt.format(fromIso(iso));
}

export function shortDate(iso: string): string {
  return shortFmt.format(fromIso(iso));
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function timeInputValue(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function parseTimeInput(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
