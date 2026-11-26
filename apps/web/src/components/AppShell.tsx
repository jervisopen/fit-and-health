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

export function AppShell() {
  return (
    <div className="min-h-full">
      <main className="mx-auto max-w-xl pb-28">
        <Outlet />
      </main>
      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
        <ul className="mx-auto grid h-16 max-w-xl grid-cols-5">
          {TABS.map(({ to, label, icon: Icon, end, center }) => (
            <li key={to} className="flex justify-center">
              <NavLink to={to} end={end}
                className={({ isActive }) => cx("flex w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  isActive ? "text-brand" : "text-ink-3")}>
                {({ isActive }) => center ? (
                  <>
                    <span className={cx("-mt-7 flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-4 ring-bg",
                      isActive ? "bg-brand text-brand-ink" : "bg-food text-white")}>
                      <Icon size={24} strokeWidth={2.2} />
                    </span>
                    <span>{label}</span>
                  </>
                ) : (
                  <>
                    <Icon size={22} strokeWidth={isActive ? 2.4 : 1.8} />
                    <span>{label}</span>
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
