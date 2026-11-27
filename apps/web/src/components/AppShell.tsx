import { NavLink, Outlet } from "react-router";
import { Camera, Hourglass, NotebookPen, Salad, User } from "lucide-react";
import { cx } from "./ui.tsx";

const TABS = [
  { to: "/", label: "Diary", icon: NotebookPen, end: true },
  { to: "/fasting", label: "Fasting", icon: Hourglass },
  { to: "/snap", label: "Snap", icon: Camera, center: true },
  { to: "/foods", label: "My foods", icon: Salad },
  { to: "/me", label: "Me", icon: User },
];

/** Tabs live in a floating frosted-glass pill with Snap as the round button in the middle. */
export function AppShell() {
  return (
    <div className="min-h-full">
      <main className="mx-auto max-w-xl pb-32">
        <Outlet />
      </main>
      <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <ul className="pointer-events-auto mx-auto grid h-16 max-w-md grid-cols-5 items-center glass rounded-full px-1.5">
          {TABS.map(({ to, label, icon: Icon, end, center }) => (
            <li key={to} className="flex justify-center">
              <NavLink to={to} end={end} aria-label={label}
                className={({ isActive }) => cx("relative flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium transition-colors",
                  center ? "" : isActive ? "text-brand" : "text-ink-2 hover:text-ink")}>
                {({ isActive }) => center ? (
                  <span className={cx("flex h-12 w-12 items-center justify-center rounded-full transition-colors",
                    isActive ? "bg-brand text-brand-ink" : "bg-food text-white")}>
                    <Icon size={22} strokeWidth={2.2} />
                  </span>
                ) : (
                  <>
                    <Icon size={21} strokeWidth={isActive ? 2.4 : 1.8} />
                    <span>{label}</span>
                    <span className={cx("h-1 w-1 rounded-full", isActive ? "bg-brand" : "bg-transparent")} aria-hidden="true" />
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
