import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Lock, Upload } from "lucide-react";
import { Button, ErrorNote, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { API_MODE } from "../../lib/transport.ts";
import { localRestore, setupLocalFoods } from "../../local/client.ts";

const SKIP_KEY = "fh.skipFoodSetup";

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
  const [skip, setSkip] = useState(skipped);
  if (API_MODE === "server") return <>{children}</>;
  if (health.isPending) return <div className="flex min-h-dvh items-center justify-center"><Spinner label="Opening your diary" /></div>;
  if (health.isError) return <Welcome error={health.error} />;
  if (health.data.foods === 0 && !skip) return <Welcome onSkip={() => {
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

function Welcome({ onSkip, error: startError }: { onSkip?: () => void; error?: unknown }) {
  const setup = useFoodSetup();
  const fileInput = useRef<HTMLInputElement>(null);
  const [restoreError, setRestoreError] = useState<unknown>(null);
  const busy = setup.progress !== null;

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
            <b>One-time download: about 2 MB of food data.</b> Indian recipes from INDB and ingredients from IFCT 2017,
            fetched directly from their public copies and turned into a searchable database on your phone.
          </span>
        </li>
      </ul>

      {startError ? <div className="mt-6"><ErrorNote error={startError} /></div> : null}

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
