import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, HardDrive, RefreshCw, Upload } from "lucide-react";
import { Button, Card, ErrorNote } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { today } from "../../lib/dates.ts";
import { localBackup, localInfo, localRestore } from "../../local/client.ts";
import { requestPersistence, useFoodSetup } from "../setup/SetupGate.tsx";

/** Local mode: where the data lives, backups, and refreshing the food database. */
export function DataCard({ downloaded }: { downloaded: boolean }) {
  const toast = useToast();
  const setup = useFoodSetup();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<unknown>(null);
  const storage = useQuery({
    queryKey: ["storage"],
    queryFn: async () => {
      const [info, persisted, estimate] = await Promise.all([
        localInfo(),
        navigator.storage?.persisted?.().catch(() => false) ?? false,
        navigator.storage?.estimate?.().catch(() => null) ?? null,
      ]);
      return { ...info, persisted, usedMb: estimate?.usage ? estimate.usage / 1e6 : null };
    },
  });
  const s = storage.data;

  const backup = async () => {
    setError(null);
    try {
      const blob = await localBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fit-and-health-${today()}.db`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 font-semibold"><HardDrive size={18} /> Your data</h2>
      <p className="mt-1 text-sm text-ink-2">
        Stored only in this browser on this device{s?.usedMb ? ` (${s.usedMb.toFixed(1)} MB)` : ""}. It isn't synced anywhere,
        so back it up now and then.
      </p>
      {s && !s.persistent && (
        <p className="mt-2 rounded-lg bg-warn-soft p-2 text-xs text-warn">
          This browser can't keep data here (private browsing?). Everything is lost when you close the tab.
        </p>
      )}
      {s?.persistent && !s.persisted && (
        <p className="mt-2 rounded-lg bg-warn-soft p-2 text-xs text-warn">
          The browser may clear this data if your phone runs low on space. Installing the app (Add to Home screen) protects it.{" "}
          <button type="button" className="font-semibold underline" onClick={async () => {
            if (await requestPersistence()) toast("Storage protected");
            void storage.refetch();
          }}>Protect it</button>
        </p>
      )}
      {error ? <div className="mt-2"><ErrorNote error={error} /></div> : null}
      {setup.error ? <div className="mt-2"><ErrorNote error={setup.error} /></div> : null}
      {setup.progress ? (
        <div className="mt-3" aria-live="polite">
          <p className="text-sm">{setup.progress.stage}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${setup.progress.pct}%` }} />
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => void backup()}><Download size={18} /> Back up</Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}><Upload size={18} /> Restore</Button>
          <Button variant="ghost" className="col-span-2" onClick={() => void setup.run().then(() => toast("Food database updated"))}>
            <RefreshCw size={18} /> {downloaded ? "Update food database" : "Download food database"}
          </Button>
        </div>
      )}
      <input ref={fileInput} type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/octet-stream" hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (!confirm("Replace everything on this device with this backup? Your current diary will be overwritten.")) return;
          setError(null);
          try {
            await localRestore(file);
            location.reload();
          } catch (err) {
            setError(err);
          }
        }} />
      <p className="mt-2 text-xs text-ink-3">Backups leave out your Snap AI key.</p>
    </Card>
  );
}
