/**
 * "Install app": Android/desktop Chrome offer a one-tap install prompt (beforeinstallprompt);
 * iPhone/iPad need Share → Add to Home Screen. Installing also makes the browser far less likely
 * to clear the diary when storage runs low.
 */
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

/** Call once at startup: the prompt event can fire before React renders. */
export function listenForInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button instead of the browser's mini-bar
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => { deferred = null; notify(); });
}

export const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** "prompt": one tap installs. "ios": show Share → Add to Home Screen. null: installed or not possible. */
export function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const mode: "prompt" | "ios" | null = isStandalone() ? null : deferred ? "prompt" : isIos() ? "ios" : null;
  const install = async () => {
    if (!deferred) return false;
    const e = deferred;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferred = null;
    notify();
    return outcome === "accepted";
  };
  return { mode, install };
}
