import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock, Database, Target } from "lucide-react";
import { Card, Spinner } from "../../components/ui.tsx";
import { today, minutesToTime } from "../../lib/dates.ts";
import { kcal } from "../../lib/format.ts";
import { useSettings } from "../../lib/queries.ts";

export function SettingsPage() {
  const settings = useSettings(today());
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await fetch("/api/health")).json() as Promise<{ foods: number; foodDbVersion: string | null }>,
  });
  const s = settings.data;
  const enabledMeals = s?.meals.filter((m) => m.enabled) ?? [];

  return (
    <div className="safe-top space-y-3 px-4 pt-4">
      <h1 className="text-2xl font-bold">Me</h1>
      {!s ? <Spinner /> : (
        <Card>
          <Row to="/me/goals" icon={<Target size={20} />} title="Daily goals"
            detail={s.goalsAreDefault ? "Not set (2,000 kcal default)"
              : `${kcal(s.goals.calories)} kcal · P ${s.goals.protein_g} g · C ${s.goals.carbs_g} g · F ${s.goals.fat_g} g`} />
          <Row to="/me/meals" icon={<Clock size={20} />} title="Meals"
            detail={enabledMeals.map((m) => `${m.displayName} ${minutesToTime(m.timeMin)}`).join(" · ")} />
        </Card>
      )}
      <Card className="p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Database size={18} /> Food database</h2>
        <p className="mt-1 text-sm text-ink-2">
          {health.data ? `${health.data.foods.toLocaleString()} foods` : "…"}
          {health.data?.foodDbVersion && ` · built ${new Date(health.data.foodDbVersion).toLocaleDateString()}`}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          Indian recipes: INDB (Anuvaad, 2024). Ingredients: IFCT 2017 (ICMR-NIN). Packaged foods: Open Food Facts (ODbL).
          Values are estimates; dishes vary by recipe.
        </p>
      </Card>
    </div>
  );
}

function Row({ to, icon, title, detail }: { to: string; icon: React.ReactNode; title: string; detail: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-b-0">
      <span className="text-brand">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block truncate text-xs text-ink-3">{detail}</span>
      </span>
      <ChevronRight size={18} className="text-ink-3" />
    </Link>
  );
}
