import { useState } from "react";
import { Download, Share, X } from "lucide-react";
import { useInstall } from "../lib/install.ts";
import { Button, IconButton } from "./ui.tsx";

const DISMISS_KEY = "fh.installDismissed";

/** Diary banner (dismissible) or Me row (always): install fit&health to the home screen. */
export function InstallCard({ dismissible = false }: { dismissible?: boolean }) {
  const { mode, install } = useInstall();
  const [hidden, setHidden] = useState(() => {
    try { return dismissible && localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  if (!mode || hidden) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
    setHidden(true);
  };

  return (
    <section className="flex items-start gap-3 rounded-3xl bg-brand-soft p-4 text-brand">
      <img src="/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">Install fit&amp;health</h2>
        {mode === "prompt" ? (
          <>
            <p className="mt-0.5 text-sm text-ink-2">Opens like an app, works offline, and keeps your diary safer on this phone.</p>
            <Button className="mt-3 h-10" onClick={() => void install()}><Download size={18} /> Install app</Button>
          </>
        ) : (
          <p className="mt-0.5 text-sm text-ink-2">
            Tap <Share size={15} className="-mt-0.5 inline" aria-label="Share" /> Share at the bottom of Safari, then <b>Add to Home Screen</b>.
            It opens like an app and keeps your diary safer.
          </p>
        )}
      </div>
      {dismissible && <IconButton label="Hide" className="-mr-2 -mt-2 text-ink-3" onClick={dismiss}><X size={18} /></IconButton>}
    </section>
  );
}
