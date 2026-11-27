import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, History, RotateCcw } from "lucide-react";
import { Button, Card, ErrorNote, IconButton, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { localRestoreSnapshot, localSnapshotFile, localSnapshotNow, localSnapshots, type SnapshotMeta } from "../../local/client.ts";
import { entriesText, snapshotWhen } from "../setup/SetupGate.tsx";

const REASON: Record<SnapshotMeta["reason"], string> = {
  daily: "Daily",
  "before-update": "Before an app update",
  "before-restore": "Before a restore",
};

/** Me → Your data: the automatic snapshots kept on this device. */
export function AutoBackupsCard() {
  const toast = useToast();
  const list = useQuery({ queryKey: ["snapshots"], queryFn: localSnapshots });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const download = async (s: SnapshotMeta) => {
    setError(null);
    try {
      const blob = await localSnapshotFile(s.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fit-and-health-auto-${new Date(s.takenAt).toISOString().slice(0, 10)}.db`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { setError(e); }
  };

  const restore = async (s: SnapshotMeta) => {
    if (!confirm(`Go back to your diary as it was on ${snapshotWhen(s)}? Anything you logged after that is replaced (a copy of today's diary is saved first).`)) return;
    setBusy(s.id);
    setError(null);
    try {
      await localRestoreSnapshot(s.id);
      location.reload();
    } catch (e) { setError(e); setBusy(null); }
  };

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 font-semibold"><History size={18} /> Automatic backups</h2>
      <p className="mt-1 text-sm text-ink-2">
        A copy of your diary is saved on this device every day, and before app updates and restores. The last 7 are kept.
      </p>
      {!list.data ? <Spinner /> : !list.data.snapshots.length ? (
        <p className="mt-3 text-sm text-ink-3">None yet. The first one is made once you've logged something.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {list.data.snapshots.map((s) => (
            <li key={s.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{snapshotWhen(s)}</span>
                <span className="block text-xs text-ink-3">{REASON[s.reason]} · {entriesText(s.entries)} · {(s.size / 1e6).toFixed(1)} MB</span>
              </span>
              <IconButton label={`Download the backup from ${snapshotWhen(s)}`} onClick={() => void download(s)}><Download size={18} /></IconButton>
              <IconButton label={`Restore the backup from ${snapshotWhen(s)}`} disabled={busy !== null} onClick={() => void restore(s)}><RotateCcw size={18} /></IconButton>
            </li>
          ))}
        </ul>
      )}
      {error ? <div className="mt-2"><ErrorNote error={error} /></div> : null}
      <Button variant="ghost" className="-ml-4 mt-1 h-10 text-sm" disabled={busy !== null} onClick={async () => {
        await localSnapshotNow();
        await list.refetch();
        toast("Backup saved on this device");
      }}>Save a backup now</Button>
      <p className="mt-1 text-xs text-ink-3">
        These protect against app or browser glitches. They're stored in the same browser, so clearing this site's data or losing
        the phone removes them too. Use Back up above to keep a copy somewhere else, like Google Drive.
      </p>
    </Card>
  );
}
