import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Target } from "lucide-react";
import type { FoodLogDTO, MealDTO } from "../../../../../packages/shared/src/api.ts";
import { ErrorNote, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { addDays, isValidIso, today } from "../../lib/dates.ts";
import { useCopyMeal, useDiary, useTrackerDay } from "../../lib/queries.ts";
import { TrackersCard } from "../trackers/TrackersCard.tsx";
import { api } from "../../lib/api.ts";
import { DateStrip } from "./DateStrip.tsx";
import { SummaryCard } from "./SummaryCard.tsx";
import { MealCard } from "./MealCard.tsx";
import { LogSheet } from "./LogSheet.tsx";

export function DiaryPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("date");
  const date = isValidIso(raw) ? raw : today();
  const diary = useDiary(date);
  const trackers = useTrackerDay(date);
  const t = trackers.data;
  const exerciseKcal = t?.settings.workout.enabled && t.settings.workout.addToBudget ? t.workout.netKcal : 0;
  const [openLog, setOpenLog] = useState<FoodLogDTO | null>(null);
  const copy = useCopyMeal();
  const toast = useToast();

  const setDate = (d: string) => setParams(d === today() ? {} : { date: d }, { replace: true });

  const copyPrevious = async (meal: MealDTO) => {
    const prev = addDays(date, -1);
    const prevDay = await api.diary(prev);
    const source = prevDay.meals.find((m) => m.code === meal.code);
    if (!source?.logs.length) {
      toast(`Nothing logged for ${meal.name} the day before`);
      return;
    }
    const created = await copy.mutateAsync([{ date: prev, mealType: meal.code }, { date, mealType: meal.code }]);
    toast(`Copied ${created.length} item${created.length === 1 ? "" : "s"} from the day before`);
  };

  return (
    <>
      <DateStrip date={date} goalKcal={diary.data?.goals.calories ?? 2000} onChange={setDate} />
      <div className="space-y-3 px-4 pt-1">
        {diary.isLoading && <Spinner />}
        {diary.error && <ErrorNote error={diary.error} />}
        {diary.data && (
          <>
            {diary.data.goalsAreDefault && (
              <Link to="/me/goals" className="flex items-center gap-3 rounded-2xl bg-brand-soft p-4 text-brand">
                <Target size={22} className="shrink-0" />
                <span className="text-sm"><b>Set your goals.</b> You're seeing a default 2,000 kcal target.</span>
              </Link>
            )}
            <SummaryCard day={diary.data} exerciseKcal={exerciseKcal} />
            {t && <TrackersCard day={t} />}
            {diary.data.meals.map((m) => (
              <MealCard key={m.code} meal={m} date={date} onOpenLog={setOpenLog} onCopyPrevious={() => copyPrevious(m)} />
            ))}
          </>
        )}
      </div>
      <LogSheet log={openLog} onClose={() => setOpenLog(null)} />
    </>
  );
}
