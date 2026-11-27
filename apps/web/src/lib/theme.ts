/**
 * Light / dark theme. "system" follows the phone; "light" and "dark" are saved on this device and
 * applied as data-theme on <html> (index.html applies it before the first paint, so there's no flash).
 */
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "fh.theme";
const STATUS_BAR = { light: "#2f6f4f", dark: "#151a17" } as const;
const listeners = new Set<() => void>();

export function themeChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

export function effectiveTheme(choice = themeChoice()): "light" | "dark" {
  return choice === "system" ? (systemDark() ? "dark" : "light") : choice;
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  // Status bar colour on Android: follow the chosen theme, or the phone's when on system.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const forMedia = m.media.includes("dark") ? "dark" : "light";
    m.content = STATUS_BAR[choice === "system" ? forMedia : choice];
  });
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* private mode: still applies for this visit */ }
  apply(choice);
  for (const l of listeners) l();
}

/** Current choice and the theme actually showing; re-renders on changes (here or in the phone settings). */
export function useTheme() {
  const [, bump] = useState(0);
  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    listeners.add(rerender);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", rerender);
    return () => { listeners.delete(rerender); mq.removeEventListener("change", rerender); };
  }, []);
  const choice = themeChoice();
  return { choice, theme: effectiveTheme(choice), setChoice: setThemeChoice };
}

/** Sync the status-bar colour with a saved choice once at start (data-theme is set by index.html). */
export function initTheme() {
  apply(themeChoice());
}
