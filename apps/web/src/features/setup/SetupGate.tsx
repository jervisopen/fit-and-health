import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, History, Lock, TriangleAlert, Upload } from "lucide-react";
import { Button, ErrorNote, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { API_MODE } from "../../lib/transport.ts";
import { localInfo, localRestore, localRestoreSnapshot, localSnapshots, onDatabaseStatus, setupLocalFoods, type SnapshotMeta } from "../../local/client.ts";

const SKIP_KEY = "fh.skipFoodSetup";
const DISMISS_KEY = "fh.dismissedRecovery";

function dismissedRecovery(id: string) {
  try { return localStorage.getItem(DISMISS_KEY) === id; } catch { return false; }
}

const whenFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const snapshotWhen = (s: SnapshotMeta) => whenFmt.format(s.takenAt);
export const entriesText = (n: number) => `${n.toLocaleString()} ${n === 1 ? "entry" : "entries"}`;

function skipped() {
  try { return localStorage.getItem(SKIP_KEY) === "1"; } catch { return false; }
}

/** Ask the browser not to evict this site's data (it's the only copy). */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

/** Local mode: on first visit, build the food database on this device before showing the app. */
export function SetupGate({ children }: { children: ReactNode }) {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, enabled: API_MODE === "local", staleTime: Infinity });
  // An empty diary with an automatic backup on the device means something went wrong: offer it back.
  const backups = useQuery({ queryKey: ["snapshots", "gate"], queryFn: localSnapshots, enabled: API_MODE === "local" && health.isSuccess, staleTime: Infinity });
  const [recoveryDone, setRecoveryDone] = useState(false);
  const [skip, setSkip] = useState(skipped);
  const [dbStatus, setDbStatus] = useState<"starting" | "waiting" | "open">("starting");
  useEffect(() => (API_MODE === "local" ? onDatabaseStatus(setDbStatus) : undefined), []);
  if (API_MODE === "server") return <>{children}</>;
  if (health.isPending) {
    return dbStatus === "waiting" ? (
      <Notice title="fit&health is open somewhere else"
        text="Your diary can only be open in one tab or window at a time. Close the other one (or the installed app) and this page continues by itself." />
    ) : <div className="flex min-h-dvh items-center justify-center"><Spinner label="Opening your diary" /></div>;
  }
  // Never fall through to first-run setup on an error: the saved diary may be fine, just not opened.
  if (health.isError) return <Notice title="Couldn't open your diary" error={health.error} retry />;
  if (backups.isPending) return <div className="flex min-h-dvh items-center justify-center"><Spinner label="Opening your diary" /></div>;
  const best = backups.data?.entries === 0 ? backups.data.snapshots.find((x) => x.entries > 0) : undefined;
  if (best && !recoveryDone && !dismissedRecovery(best.id)) {
    return <Recover snapshot={best} others={backups.data!.snapshots.filter((x) => x.id !== best.id && x.entries > 0)} onDismiss={() => {
      try { localStorage.setItem(DISMISS_KEY, best.id); } catch { /* private mode */ }
      setRecoveryDone(true);
    }} />;
  }
  if (!health.data.foodDbVersion && !skip) return <Welcome onSkip={() => {
    try { localStorage.setItem(SKIP_KEY, "1"); } catch { /* private mode */ }
    setSkip(true);
  }} />;
  return <>{children}</>;
}

/** Download the public datasets and build the food database; used by the welcome screen and Me → Your data. */
export function useFoodSetup() {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ stage: string; pct: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    setError(null);
    setProgress({ stage: "Starting…", pct: 0 });
    try {
      void requestPersistence();
      await setupLocalFoods((stage, pct) => setProgress({ stage, pct }));
      await qc.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setProgress(null);
    }
  };
  return { run, progress, error };
}

function Recover({ snapshot, others, onDismiss }: { snapshot: SnapshotMeta; others: SnapshotMeta[]; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pick, setPick] = useState(snapshot);
  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await localRestoreSnapshot(pick.id);
      location.reload();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="flex items-center gap-2 text-xl font-bold"><History size={22} className="text-brand" /> Bring back your diary?</h1>
      <p className="text-ink-2">
        Your diary on this device is empty, but there's an automatic backup from <b>{snapshotWhen(pick)}</b> with {entriesText(pick.entries)}.
      </p>
      {others.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-ink-3">Other backups:</p>
          <div className="flex flex-wrap gap-2">
            {[snapshot, ...others].map((s) => (
              <button key={s.id} type="button" onClick={() => setPick(s)} aria-pressed={pick.id === s.id}
                className={pick.id === s.id ? "rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-bg" : "rounded-full bg-surface-2 px-3 py-1.5 text-xs text-ink-2"}>
                {snapshotWhen(s)} · {s.entries}
              </button>
            ))}
          </div>
        </div>
      )}
      {error ? <ErrorNote error={error} /> : null}
      <Button block onClick={() => void restore()} disabled={busy}>{busy ? "Restoring…" : "Restore this backup"}</Button>
      <button type="button" onClick={onDismiss} disabled={busy} className="py-2 text-center text-sm text-ink-3">
        Start with an empty diary (the backup stays under Me → Your data)
      </button>
    </main>
  );
}

function Notice({ title, text, error, retry }: { title: string; text?: string; error?: unknown; retry?: boolean }) {
  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="flex items-center gap-2 text-xl font-bold"><TriangleAlert size={22} className="text-warn" /> {title}</h1>
      {text && <p className="text-ink-2">{text}</p>}
      {error ? <ErrorNote error={error} /> : null}
      {retry && <>
        <p className="text-sm text-ink-3">Your saved data is not deleted. Close other fit&amp;health tabs or windows, then try again.</p>
        <Button block onClick={() => location.reload()}>Try again</Button>
      </>}
    </main>
  );
}

function Welcome({ onSkip, error: startError }: { onSkip?: () => void; error?: unknown }) {
  const setup = useFoodSetup();
  const fileInput = useRef<HTMLInputElement>(null);
  const [restoreError, setRestoreError] = useState<unknown>(null);
  const busy = setup.progress !== null;
  const info = useQuery({ queryKey: ["storage-info"], queryFn: localInfo, staleTime: Infinity });

  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-8 pt-12">
      <h1 className="text-3xl font-bold">fit&amp;health</h1>
      <p className="mt-2 text-ink-2">Food diary, meal photos and fasting. Free, with no account and no ads.</p>

      <ul className="mt-8 space-y-4 text-sm">
        <li className="flex gap-3">
          <Lock size={20} className="mt-0.5 shrink-0 text-brand" />
          <span><b>Your data stays on this device.</b> Nothing is uploaded. There's no account to make.</span>
        </li>
        <li className="flex gap-3">
          <Database size={20} className="mt-0.5 shrink-0 text-brand" />
          <span>
            <b>One-time download: about 2.5 MB of food data.</b> Indian recipes from INDB, ingredients from IFCT 2017 and 7,500+ everyday foods from USDA,
            fetched directly from their public copies and turned into a searchable database on your phone.
          </span>
        </li>
      </ul>

      {startError ? <div className="mt-6"><ErrorNote error={startError} /></div> : null}
      {info.data && !info.data.persistent && (
        <p className="mt-6 rounded-lg bg-warn-soft p-3 text-sm text-warn">
          This browser can't save data for this site, so everything is lost when you close it. Use an up-to-date
          Chrome, Edge, Firefox or Safari, outside private browsing.
        </p>
      )}

      <div className="mt-auto space-y-3 pt-10">
        {busy ? (
          <div aria-live="polite">
            <p className="text-sm font-medium">{setup.progress!.stage}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${setup.progress!.pct}%` }} />
            </div>
          </div>
        ) : (
          <>
            {setup.error ? <ErrorNote error={setup.error} /> : null}
            {restoreError ? <ErrorNote error={restoreError} /> : null}
            <Button block onClick={() => void setup.run()} disabled={Boolean(startError)}>
              {setup.error ? "Try again" : "Download food data"}
            </Button>
            <Button block variant="secondary" onClick={() => fileInput.current?.click()} disabled={Boolean(startError)}>
              <Upload size={18} /> Restore a backup
            </Button>
            {onSkip && (
              <button type="button" onClick={onSkip} className="block w-full py-2 text-center text-sm text-ink-3">
                Skip. I'll add my own foods
              </button>
            )}
          </>
        )}
        <input ref={fileInput} type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/octet-stream" hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setRestoreError(null);
            try {
              await localRestore(file);
              location.reload();
            } catch (err) {
              setRestoreError(err);
            }
          }} />
      </div>
    </main>
  );
}
