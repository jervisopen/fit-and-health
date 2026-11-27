import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Minus, Plus, X } from "lucide-react";
import { useNavigate } from "react-router";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-3xl bg-surface shadow-card border border-line", className)}>{children}</section>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; block?: boolean };
export function Button({ variant = "primary", block, className, ...rest }: ButtonProps) {
  const styles = {
    primary: "bg-brand text-brand-ink hover:opacity-90",
    secondary: "bg-surface-2 text-ink hover:bg-line",
    ghost: "text-brand hover:bg-brand-soft",
    danger: "text-over hover:bg-surface-2",
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      className={cx("inline-flex h-12 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition disabled:opacity-50",
        styles, block && "w-full", className)}
    />
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={cx("inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 disabled:opacity-40", className)}>
      {children}
    </button>
  );
}

/** Top bar for full-screen (non-tab) pages. */
export function PageHeader({ title, right, back = true }: { title: ReactNode; right?: ReactNode; back?: boolean }) {
  const navigate = useNavigate();
  return (
    <header className="glass-bar safe-top sticky top-0 z-20">
      <div className="mx-auto flex h-14 max-w-xl items-center gap-1 px-2">
        {back && (
          <IconButton label="Back" onClick={() => (history.length > 1 ? navigate(-1) : navigate("/"))}>
            <ArrowLeft size={22} />
          </IconButton>
        )}
        <h1 className={cx("flex-1 truncate text-lg font-semibold", !back && "px-2")}>{title}</h1>
        {right}
      </div>
    </header>
  );
}

/** Bottom sheet dialog: backdrop click and Escape close it; focus moves inside. */
export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="animate-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="animate-sheet safe-bottom relative flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-3xl bg-surface outline-none">
        <div className="flex items-start gap-2 px-5 pt-4 pb-2">
          <h2 id={titleId} className="flex-1 text-lg font-semibold leading-snug">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1"><X size={20} /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Circular progress (calorie ring). Over-budget switches to the warning color. */
export function Ring({ value, max, size = 132, stroke = 12, children, color = "var(--food)" }: {
  value: number; max: number; size?: number; stroke?: number; children?: ReactNode; color?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const over = max > 0 && value > max;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={over ? "var(--over)" : color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 400ms ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function MacroBar({ label, value, goal, color, unit = "g" }: { label: string; value: number; goal: number; color: string; unit?: string }) {
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
  const over = goal > 0 && value > goal * 1.05;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-1 text-xs">
        <span className="font-medium text-ink-2">{label}</span>
        <span className={cx("num", over ? "text-over font-semibold" : "text-ink-3")}>
          {Math.round(value)}/{Math.round(goal)}{unit}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemax={Math.round(goal)}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? "var(--over)" : color, transition: "width 400ms ease" }} />
      </div>
    </div>
  );
}

export function Stepper({ value, onChange, step, min, label }: { value: number; onChange: (v: number) => void; step: number; min: number; label: string }) {
  const clean = (v: number) => Math.max(min, Math.round(v * 100) / 100);
  return (
    <div className="flex items-center gap-2">
      <IconButton label={`Decrease ${label}`} className="h-12 w-12 bg-surface-2" disabled={value <= min} onClick={() => onChange(clean(value - step))}>
        <Minus size={20} />
      </IconButton>
      <input
        aria-label={label}
        inputMode="decimal"
        className="num h-12 w-20 rounded-xl border border-line bg-surface text-center text-lg font-semibold"
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(e) => {
          const v = Number(e.target.value.replace(",", "."));
          if (Number.isFinite(v)) onChange(v);
        }}
        onBlur={(e) => onChange(clean(Number(e.target.value.replace(",", ".")) || min))}
      />
      <IconButton label={`Increase ${label}`} className="h-12 w-12 bg-surface-2" onClick={() => onChange(clean(value + step))}>
        <Plus size={20} />
      </IconButton>
    </div>
  );
}

/** Indian veg / non-veg marker: a dot in a square. */
export function VegMark({ isVeg }: { isVeg: boolean | null }) {
  if (isVeg === null) return <span className="inline-block h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  const color = isVeg ? "var(--veg)" : "var(--nonveg)";
  return (
    <span role="img" aria-label={isVeg ? "Vegetarian" : "Non-vegetarian"}
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px]" style={{ borderColor: color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex justify-center py-8">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{error instanceof Error ? error.message : String(error)}</p>;
}
