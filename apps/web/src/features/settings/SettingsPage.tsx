import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock, Database, Sparkles, Target } from "lucide-react";
import { Card, Spinner } from "../../components/ui.tsx";
import { today, minutesToTime } from "../../lib/dates.ts";
import { kcal } from "../../lib/format.ts";
import { useSettings } from "../../lib/queries.ts";
import { api } from "../../lib/api.ts";
import { API_MODE } from "../../lib/transport.ts";
import { DataCard } from "./DataCard.tsx";
import { AutoBackupsCard } from "./AutoBackupsCard.tsx";
import { ThemePicker } from "../../components/ThemeToggle.tsx";
import { InstallCard } from "../../components/InstallCard.tsx";

export function SettingsPage() {
  const settings = useSettings(today());
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const vision = useQuery({ queryKey: ["snap", "status"], queryFn: api.snapStatus, staleTime: 60_000 });
  const s = settings.data;
  const enabledMeals = s?.meals.filter((m) => m.enabled) ?? [];

  return (
    <div className="safe-top space-y-3 px-4 pt-4">
      <h1 className="text-2xl font-bold">Me</h1>
      <InstallCard />
      {!s ? <Spinner /> : (
        <Card>
          <Row to="/me/goals" icon={<Target size={20} />} title="Daily goals"
            detail={s.goalsAreDefault ? "Not set (2,000 kcal default)"
              : `${kcal(s.goals.calories)} kcal · P ${s.goals.protein_g} g · C ${s.goals.carbs_g} g · F ${s.goals.fat_g} g`} />
          <Row to="/me/meals" icon={<Clock size={20} />} title="Meals"
            detail={enabledMeals.map((m) => `${m.displayName} ${minutesToTime(m.timeMin)}`).join(" · ")} />
          <Row to="/me/snap-ai" icon={<Sparkles size={20} />} title="Snap AI"
            detail={!vision.data ? "…" : vision.data.configured ? `${vision.data.provider} · ${vision.data.model}` : "Not set up"} />
        </Card>
      )}
      <Card className="p-4">
        <h2 className="mb-3 font-semibold">Appearance</h2>
        <ThemePicker />
        <p className="mt-2 text-xs text-ink-3">System follows your phone's light or dark setting.</p>
      </Card>
      <Card className="p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Database size={18} /> Food database</h2>
        <p className="mt-1 text-sm text-ink-2">
          {health.data ? `${health.data.foods.toLocaleString()} foods` : "…"}
          {health.data?.foodDbVersion && ` · built ${new Date(health.data.foodDbVersion).toLocaleDateString()}`}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          Indian recipes: INDB (Anuvaad, 2024). Ingredients: IFCT 2017 (ICMR-NIN). Everyday staples and more foods: USDA FoodData Central (public domain). Packaged foods: Open Food Facts (ODbL).
          Values are estimates; dishes vary by recipe.
        </p>
      </Card>
      {API_MODE === "local" && <DataCard downloaded={!!health.data?.foodDbVersion} />}
      {API_MODE === "local" && <AutoBackupsCard />}
      <p className="pb-4 text-center text-xs text-ink-3">
        fit&amp;health is free and open source (MIT). No account, no ads, no tracking.
      </p>
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
