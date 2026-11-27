import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice } from "../lib/theme.ts";
import { cx } from "./ui.tsx";

/** Corner button: one tap switches between light and dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setChoice } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" onClick={() => setChoice(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}
      className={cx("flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-2 shadow-card transition-colors hover:text-ink", className)}>
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Me → Appearance: System (follow the phone), Light or Dark. */
export function ThemePicker() {
  const { choice, setChoice } = useTheme();
  return (
    <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button key={value} type="button" role="radio" aria-checked={choice === value} onClick={() => setChoice(value)}
          className={cx("flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition-colors",
            choice === value ? "bg-surface text-ink shadow-card" : "text-ink-3")}>
          <Icon size={16} /> {label}
        </button>
      ))}
    </div>
  );
}
