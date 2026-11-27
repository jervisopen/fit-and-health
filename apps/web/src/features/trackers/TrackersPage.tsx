import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { TRACKER_KINDS, type TrackerKind } from "../../../../../packages/shared/src/trackers.ts";
import { Card, cx, ErrorNote, PageHeader, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useInvalidateTrackers } from "../../lib/queries.ts";
import { TRACKER_META } from "./meta.tsx";

const BLURB: Record<TrackerKind, string> = {
  water: "Glasses a day, with a goal from your weight",
  weight: "Weigh-ins, trend and healthy range",
  workout: "Activities, minutes and calories burned",
  sleep: "Bedtime, wake-up and hours slept",
};

/** "Track more": choose which trackers show on the Diary. */
export function TrackersPage() {
  const invalidate = useInvalidateTrackers();
  const settings = useQuery({ queryKey: ["trackers", "settings"], queryFn: api.trackerSettings });

  const toggle = async (kind: TrackerKind, enabled: boolean) => {
    await api.updateTrackerSettings({ [kind]: { enabled } });
    await Promise.all([invalidate(), settings.refetch()]);
  };

  return (
    <div className="min-h-dvh pb-10">
      <PageHeader title="Trackers" />
      <div className="mx-auto max-w-xl space-y-3 px-4">
        <p className="text-sm text-ink-2">Choose what shows on your Diary. Everything is free, and it stays on this device.</p>
        {settings.error ? <ErrorNote error={settings.error} /> : null}
        {!settings.data ? <Spinner /> : (
          <Card>
            <ul className="divide-y divide-line">
              {TRACKER_KINDS.map((k) => {
                const m = TRACKER_META[k];
                const on = settings.data[k].enabled;
                return (
                  <li key={k} className="flex items-center gap-3 px-4 py-3">
                    <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", m.soft, m.text)}>{m.icon()}</span>
                    <Link to={`/trackers/${k}`} className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 font-medium">{m.title} <ChevronRight size={16} className="text-ink-3" /></span>
                      <span className="block truncate text-xs text-ink-3">{BLURB[k]}</span>
                    </Link>
                    <Switch checked={on} label={`Show ${m.title} on the Diary`} onChange={(v) => void toggle(k, v)} />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-brand" : "bg-line")}>
      <span className={cx("absolute top-0.5 h-6 w-6 rounded-full bg-surface shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}
