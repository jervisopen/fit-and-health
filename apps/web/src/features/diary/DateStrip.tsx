import { useRef } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, fromIso, relativeLabel, today, weekOf, weekdayShort } from "../../lib/dates.ts";
import { useSummary } from "../../lib/queries.ts";
import { cx, IconButton } from "../../components/ui.tsx";

/** Header with day navigation and a Monday-first week strip showing each day's progress. */
export function DateStrip({ date, goalKcal, onChange }: { date: string; goalKcal: number; onChange: (d: string) => void }) {
  const week = weekOf(date);
  const { data: summary } = useSummary(week[0]!, week[6]!);
  const byDate = new Map((summary ?? []).map((s) => [s.date, s.kcal]));
  const picker = useRef<HTMLInputElement>(null);
  const t = today();

  const hour = new Date().getHours();
  const greeting = date !== t ? "Your diary" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="safe-top sticky top-0 z-20 bg-bg/95 px-4 pb-3 backdrop-blur">
      <div className="flex items-end gap-1 pb-3 pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-3">{greeting}</p>
          <button type="button" className="flex max-w-full items-center gap-1.5 text-left text-2xl font-bold tracking-tight"
            onClick={() => picker.current?.showPicker?.() ?? picker.current?.click()}>
            <span className="truncate">{relativeLabel(date)}</span>
            <CalendarDays size={18} className="shrink-0 text-ink-3" />
          </button>
        </div>
        <input ref={picker} type="date" className="sr-only" tabIndex={-1} aria-label="Pick a date" value={date}
          onChange={(e) => e.target.value && onChange(e.target.value)} />
        <IconButton label="Previous day" className="bg-surface shadow-card" onClick={() => onChange(addDays(date, -1))}><ChevronLeft size={20} /></IconButton>
        <IconButton label="Next day" className="bg-surface shadow-card" onClick={() => onChange(addDays(date, 1))}><ChevronRight size={20} /></IconButton>
      </div>
      <ol className="grid grid-cols-7 gap-1 rounded-3xl border border-line bg-surface p-1.5 shadow-card">
        {week.map((d) => {
          const eaten = byDate.get(d) ?? 0;
          const pct = goalKcal ? Math.min(eaten / goalKcal, 1) : 0;
          const selected = d === date;
          return (
            <li key={d}>
              <button type="button" onClick={() => onChange(d)} aria-current={selected ? "date" : undefined}
                aria-label={`${relativeLabel(d)}${eaten ? `, ${Math.round(eaten)} kcal` : ""}`}
                className={cx("flex w-full flex-col items-center gap-1 rounded-2xl py-1.5", selected ? "bg-brand text-brand-ink" : "text-ink-2")}>
                <span className="text-[11px] uppercase">{weekdayShort(d).slice(0, 2)}</span>
                <span className={cx("num relative flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
                  d === t && !selected && "text-brand")}>
                  <svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90" aria-hidden="true">
                    <circle cx="16" cy="16" r="14" fill="none" strokeWidth="2.5"
                      stroke={selected ? "rgb(255 255 255 / 0.25)" : "var(--surface-2)"} />
                    {pct > 0 && (
                      <circle cx="16" cy="16" r="14" fill="none" strokeWidth="2.5" strokeLinecap="round"
                        stroke={eaten > goalKcal ? "var(--over)" : selected ? "currentColor" : "var(--food)"}
                        strokeDasharray={88} strokeDashoffset={88 * (1 - pct)} />
                    )}
                  </svg>
                  {fromIso(d).getDate()}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
