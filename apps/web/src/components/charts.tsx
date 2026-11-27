/** Small, dependency-free charts for the trackers. Colors come from CSS tokens. */
import { cx } from "./ui.tsx";

const narrow = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
const dayNum = new Intl.DateTimeFormat(undefined, { day: "numeric" });
const at = (iso: string) => new Date(`${iso}T12:00:00`);

/** Bars per day with an optional dashed goal line. Days at or over the goal are full colour. */
export function BarChart({ days, goal, color, format, today, height = 120 }: {
  days: { date: string; value: number | null }[];
  goal?: number;
  color: string;
  format: (v: number) => string;
  today?: string;
  height?: number;
}) {
  const max = Math.max(goal ? goal * 1.2 : 0, ...days.map((d) => d.value ?? 0), 1);
  const many = days.length > 10;
  return (
    <div>
      <div className="relative" style={{ height }}>
        {goal ? (
          <div className="absolute inset-x-0 border-t border-dashed border-ink-3/60" style={{ bottom: (goal / max) * height }} aria-hidden="true" />
        ) : null}
        <ol className={cx("absolute inset-0 grid items-end", many ? "gap-[3px]" : "gap-2")} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d) => {
            const v = d.value ?? 0;
            const met = goal ? v >= goal : true;
            return (
              <li key={d.date} className="flex h-full flex-col justify-end">
                <div title={`${d.date}: ${d.value === null ? "–" : format(v)}`} aria-label={`${d.date}: ${d.value === null ? "not logged" : format(v)}`}
                  className={cx("rounded-t-[4px]", d.date === today && "ring-2 ring-ink/20")}
                  style={{ height: v ? Math.max((v / max) * height, 3) : 0, background: color, opacity: met ? 1 : 0.45 }} />
              </li>
            );
          })}
        </ol>
      </div>
      <ol className={cx("mt-1 grid text-center text-[11px] text-ink-3", many ? "gap-[3px]" : "gap-2")} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d, i) => (
          <li key={d.date} className={d.date === today ? "font-bold text-ink" : ""}>
            {many ? (i % 5 === 0 || d.date === today ? dayNum.format(at(d.date)) : "") : narrow.format(at(d.date))}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Weight over time: points joined by a line, with an optional healthy band and goal line. */
export function LineChart({ points, from, to, band, goal, color, unit, height = 160 }: {
  points: { date: string; value: number }[];
  from: string;
  to: string;
  band?: { min: number; max: number } | null;
  goal?: number | null;
  color: string;
  unit: string;
  height?: number;
}) {
  if (!points.length) return <p className="py-10 text-center text-sm text-ink-3">No weigh-ins in this period yet.</p>;
  const W = 320;
  const pad = { l: 34, r: 8, t: 10, b: 18 };
  const values = [...points.map((p) => p.value), ...(goal ? [goal] : [])];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (band) { lo = Math.min(lo, band.min); hi = Math.max(hi, band.max); }
  const span = Math.max(hi - lo, 2);
  lo -= span * 0.1; hi += span * 0.1;
  const t0 = at(from).getTime();
  const t1 = Math.max(at(to).getTime(), t0 + 86_400_000);
  const x = (iso: string) => pad.l + ((at(iso).getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1].map((v) => Math.round(v));
  const short = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`Weight from ${points[0]!.value} to ${points.at(-1)!.value} ${unit}`}>
      {band && (
        <rect x={pad.l} width={W - pad.l - pad.r} y={y(band.max)} height={Math.max(0, y(band.min) - y(band.max))}
          fill="var(--brand-soft)" opacity={0.8} />
      )}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--ink-3)">{t}</text>
        </g>
      ))}
      {goal ? <line x1={pad.l} x2={W - pad.r} y1={y(goal)} y2={y(goal)} stroke="var(--ink-3)" strokeDasharray="4 3" strokeWidth={1} /> : null}
      <polyline fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round"
        points={points.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")} />
      {points.map((p) => <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={points.length > 20 ? 2 : 3} fill={color} />)}
      <text x={pad.l} y={height - 4} fontSize={10} fill="var(--ink-3)">{short.format(at(from))}</text>
      <text x={W - pad.r} y={height - 4} fontSize={10} fill="var(--ink-3)" textAnchor="end">{short.format(at(to))}</text>
    </svg>
  );
}
