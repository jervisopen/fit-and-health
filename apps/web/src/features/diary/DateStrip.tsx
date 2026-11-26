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

  return (
    <div className="safe-top sticky top-0 z-20 bg-bg/95 px-2 pb-2 backdrop-blur">
      <div className="flex h-14 items-center gap-1">
        <IconButton label="Previous day" onClick={() => onChange(addDays(date, -1))}><ChevronLeft size={22} /></IconButton>
        <button type="button" className="flex flex-1 items-center justify-center gap-1.5 text-lg font-semibold"
          onClick={() => picker.current?.showPicker?.() ?? picker.current?.click()}>
          {relativeLabel(date)}
          <CalendarDays size={18} className="text-ink-3" />
        </button>
        <input ref={picker} type="date" className="sr-only" tabIndex={-1} aria-label="Pick a date" value={date}
          onChange={(e) => e.target.value && onChange(e.target.value)} />
        <IconButton label="Next day" onClick={() => onChange(addDays(date, 1))}><ChevronRight size={22} /></IconButton>
      </div>
      <ol className="grid grid-cols-7 gap-1">
        {week.map((d) => {
          const eaten = byDate.get(d) ?? 0;
          const pct = goalKcal ? Math.min(eaten / goalKcal, 1) : 0;
          const selected = d === date;
          return (
            <li key={d}>
              <button type="button" onClick={() => onChange(d)} aria-current={selected ? "date" : undefined}
                aria-label={`${relativeLabel(d)}${eaten ? `, ${Math.round(eaten)} kcal` : ""}`}
                className={cx("flex w-full flex-col items-center gap-1 rounded-xl py-1.5", selected ? "bg-brand text-brand-ink" : "text-ink-2")}>
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
