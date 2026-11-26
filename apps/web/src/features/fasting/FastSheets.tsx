import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { FastingLogDTO, FastingStatusDTO } from "../../../../../packages/shared/src/fasting.ts";
import { formatDuration, HOUR, MINUTE } from "../../../../../packages/shared/src/time.ts";
import { Button, ErrorNote, Sheet } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { clockTime, fromLocalInput, toLocalInput, useFastingMutation } from "./hooks.ts";

function TimeField({ label, value, onChange, max }: { label: string; value: number; onChange: (ms: number) => void; max: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-2">{label}</span>
      <input type="datetime-local" className="input" value={toLocalInput(value)} max={toLocalInput(max)}
        onChange={(e) => e.target.value && onChange(fromLocalInput(e.target.value))} />
    </label>
  );
}

function earlyMessage(diffMs: number, what: "starting" | "finishing"): string | null {
  if (diffMs < 5 * MINUTE) return null;
  const n = diffMs >= HOUR ? Math.round(diffMs / HOUR) : Math.round(diffMs / MINUTE);
  const unit = diffMs >= HOUR ? (n === 1 ? "hour" : "hours") : "minutes";
  return `You are ${what} your fast ${n} ${unit} early today.`;
}

export function StartFastSheet({ open, status, onClose }: { open: boolean; status: FastingStatusDTO; onClose: () => void }) {
  const [startedAt, setStartedAt] = useState(Date.now());
  const toast = useToast();
  const start = useFastingMutation((t: number) => api.startFast(t));
  useEffect(() => { if (open) setStartedAt(Date.now()); }, [open]);
  if (!open) return null;

  const now = Date.now();
  const next = status.eating?.nextFastAt;
  const invalid = startedAt > now + MINUTE ? "Start time cannot be in the future"
    : status.lastFast?.endedAt && startedAt < status.lastFast.endedAt ? "Start time is before your last fast ended" : null;

  return (
    <Sheet open onClose={onClose} title="Start fast"
      footer={<Button block className="bg-fast text-fast-ink" disabled={!!invalid || start.isPending}
        onClick={async () => { await start.mutateAsync(Math.min(startedAt, Date.now())); toast("Fast started"); onClose(); }}>Start fast</Button>}>
      <div className="space-y-3">
        <TimeField label="Started at" value={startedAt} max={now} onChange={setStartedAt} />
        <div className="flex gap-2">
          {[0, 30, 60, 120].map((m) => (
            <button key={m} type="button" className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm" onClick={() => setStartedAt(Date.now() - m * MINUTE)}>
              {m === 0 ? "Now" : `${m >= 60 ? `${m / 60} h` : `${m} min`} ago`}
            </button>
          ))}
        </div>
        {next && next > startedAt && <p className="text-sm text-ink-2">{earlyMessage(next - startedAt, "starting")} Your fast will run until the scheduled end.</p>}
        {invalid && <p role="alert" className="text-sm text-over">{invalid}</p>}
        {start.error && <ErrorNote error={start.error} />}
      </div>
    </Sheet>
  );
}

export function EndFastSheet({ open, status, onClose }: { open: boolean; status: FastingStatusDTO; onClose: () => void }) {
  const fast = status.fast;
  const [endedAt, setEndedAt] = useState(Date.now());
  const [startedAt, setStartedAt] = useState(fast?.startedAt ?? Date.now());
  const toast = useToast();
  const end = useFastingMutation((b: { endedAt: number; startedAt: number }) => api.endFast(b));
  useEffect(() => { if (open && fast) { setEndedAt(Date.now()); setStartedAt(fast.startedAt); } }, [open, fast]);
  if (!open || !fast) return null;

  const now = Date.now();
  const duration = endedAt - startedAt;
  const reached = duration >= fast.targetEndAt - fast.startedAt - MINUTE;
  const invalid = endedAt > now + MINUTE ? "End time cannot be in future"
    : endedAt <= startedAt ? "End time cannot be earlier than start time"
    : startedAt > now ? "Start time cannot be in future" : null;

  return (
    <Sheet open onClose={onClose} title={reached ? "Fasting completed!" : "End fast"}
      footer={<Button block disabled={!!invalid || end.isPending}
        onClick={async () => {
          const r = await end.mutateAsync({ endedAt: Math.min(endedAt, Date.now()), startedAt });
          toast(r.log.isGoalMet ? "Good job, you finished your fast successfully" : `Fast saved · ${formatDuration(duration)}`);
          onClose();
        }}>End fast</Button>}>
      <div className="space-y-3">
        <div className={reached ? "rounded-xl bg-fast-soft p-4 text-center" : "rounded-xl bg-surface-2 p-4 text-center"}>
          <p className="text-sm text-ink-2">You fasted for</p>
          <p className={reached ? "num text-3xl font-bold text-fast" : "num text-3xl font-bold"}>{formatDuration(Math.max(duration, 0))}</p>
          <p className="mt-1 text-xs text-ink-3">Goal {formatDuration(fast.targetEndAt - fast.startedAt)} · ends {clockTime(fast.targetEndAt, now)}</p>
        </div>
        {!reached && !invalid && <p className="text-sm text-ink-2">{earlyMessage(fast.targetEndAt - endedAt, "finishing")}</p>}
        <TimeField label="Started" value={startedAt} max={now} onChange={setStartedAt} />
        <TimeField label="Ended" value={endedAt} max={now} onChange={setEndedAt} />
        {invalid && <p role="alert" className="text-sm text-over">{invalid}</p>}
        {end.error && <ErrorNote error={end.error} />}
      </div>
    </Sheet>
  );
}

export function EditFastSheet({ log, onClose }: { log: FastingLogDTO | null; onClose: () => void }) {
  const [startedAt, setStartedAt] = useState(0);
  const [endedAt, setEndedAt] = useState(0);
  const toast = useToast();
  const update = useFastingMutation((b: { id: string; startedAt: number; endedAt: number }) => api.updateFast(b.id, b));
  const remove = useFastingMutation((id: string) => api.deleteFast(id));
  useEffect(() => { if (log) { setStartedAt(log.startedAt); setEndedAt(log.endedAt ?? Date.now()); } }, [log]);
  if (!log) return null;

  const now = Date.now();
  const invalid = endedAt > now + MINUTE || startedAt > now ? "Times cannot be in the future"
    : endedAt <= startedAt ? "End time cannot be earlier than start time" : null;

  return (
    <Sheet open onClose={onClose} title="Edit fast"
      footer={
        <div className="flex gap-2">
          <Button variant="danger" aria-label="Delete this fast" disabled={remove.isPending}
            onClick={async () => { if (!confirm("Delete this fast from your history?")) return; await remove.mutateAsync(log.id); toast("Fast deleted"); onClose(); }}>
            <Trash2 size={18} /> Delete
          </Button>
          <Button block disabled={!!invalid || update.isPending}
            onClick={async () => { await update.mutateAsync({ id: log.id, startedAt, endedAt }); toast("Log updated successfully"); onClose(); }}>
            Save
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <p className="num text-center text-2xl font-bold">{formatDuration(Math.max(endedAt - startedAt, 0))}</p>
        <TimeField label="Started" value={startedAt} max={now} onChange={setStartedAt} />
        <TimeField label="Ended" value={endedAt} max={now} onChange={setEndedAt} />
        {invalid && <p role="alert" className="text-sm text-over">{invalid}</p>}
        {(update.error || remove.error) && <ErrorNote error={update.error ?? remove.error} />}
      </div>
    </Sheet>
  );
}
