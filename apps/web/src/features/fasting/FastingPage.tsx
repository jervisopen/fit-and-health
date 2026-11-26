import { useState } from "react";
import { CalendarPlus, Settings2 } from "lucide-react";
import type { FastingLogDTO } from "../../../../../packages/shared/src/fasting.ts";
import { Button, Card, ErrorNote, IconButton, Sheet, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { minutesToTime } from "../../lib/dates.ts";
import { useFastingHistory, useFastingMutation, useFastingStatus, useNow } from "./hooks.ts";
import { PlanSetup } from "./PlanSetup.tsx";
import { TimerCard } from "./TimerCard.tsx";
import { EditFastSheet, EndFastSheet, StartFastSheet } from "./FastSheets.tsx";
import { HistoryList, StagesCard, StatsCard, WeekChart } from "./Insights.tsx";

export function FastingPage() {
  const status = useFastingStatus();
  const historyQ = useFastingHistory();
  const now = useNow(1000);
  const toast = useToast();
  const [sheet, setSheet] = useState<"start" | "end" | "plan" | null>(null);
  const [editing, setEditing] = useState<FastingLogDTO | null>(null);
  const stopPlan = useFastingMutation(() => api.endFastingPlan());

  const s = status.data;
  const plan = s?.plan ?? null;

  return (
    <div className="safe-top px-4 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Fasting</h1>
        {plan && <IconButton label="Fasting plan settings" onClick={() => setSheet("plan")}><Settings2 size={22} /></IconButton>}
      </div>
      {plan && (
        <p className="text-sm text-ink-3">
          {plan.presetKey === "custom" ? `${plan.fastingHours}:${24 - plan.fastingHours}` : plan.presetKey} ·{" "}
          {plan.mode === "schedule" && plan.startsAtMin !== null
            ? `fasting from ${minutesToTime(plan.startsAtMin)} daily`
            : "start & stop manually"}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {status.isLoading && <Spinner />}
        {status.error && <ErrorNote error={status.error} />}

        {s && !plan && s.state !== "fasting" && (
          <Card className="p-4">
            <h2 className="text-lg font-semibold">Choose a fasting plan</h2>
            <p className="mb-4 text-sm text-ink-3">Alternate a daily fasting window with an eating window. Start gentle; you can change it any time.</p>
            <PlanSetup plan={null} onSaved={() => toast("Plan saved. We'll track your fasts automatically.")} />
          </Card>
        )}

        {s && (plan || s.state === "fasting") && (
          <>
            <TimerCard status={s} now={now} onStart={() => setSheet("start")} onEnd={() => setSheet("end")} />
            {historyQ.data && <StatsCard logs={historyQ.data} plan={plan} />}
            {historyQ.data && <WeekChart logs={historyQ.data} plan={plan} />}
            <StagesCard elapsedMs={s.state === "fasting" && s.fast ? now - s.fast.startedAt : null} />
            {historyQ.data && <HistoryList logs={historyQ.data} onOpen={setEditing} />}
          </>
        )}
      </div>

      {s && <StartFastSheet open={sheet === "start"} status={s} onClose={() => setSheet(null)} />}
      {s && <EndFastSheet open={sheet === "end"} status={s} onClose={() => setSheet(null)} />}
      <EditFastSheet log={editing} onClose={() => setEditing(null)} />

      {sheet === "plan" && (
        <Sheet open onClose={() => setSheet(null)} title="Fasting plan">
          <PlanSetup plan={plan} onSaved={() => { setSheet(null); toast("Plan updated"); }} />
          <div className="mt-6 space-y-2 border-t border-line pt-4">
            {plan?.mode === "schedule" && (
              <a href="/api/fasting/plan.ics" download className="flex items-center gap-2 text-sm font-semibold text-brand">
                <CalendarPlus size={18} /> Add reminders to your calendar
              </a>
            )}
            <p className="text-xs text-ink-3">Calendar reminders work without notifications from this app: 30 min before each fast, and when it ends.</p>
            <Button variant="danger" className="-ml-4" onClick={async () => {
              if (!confirm("Turn off your fasting plan? Your history is kept.")) return;
              await stopPlan.mutateAsync(undefined);
              setSheet(null);
              toast("Fasting plan turned off");
            }}>Yes, disable fast plan</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
