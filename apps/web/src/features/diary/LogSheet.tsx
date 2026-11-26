import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { FoodLogDTO } from "../../../../../packages/shared/src/api.ts";
import { MEAL_TYPES, type MealTypeCode } from "../../../../../packages/shared/src/meals.ts";
import { Button, ErrorNote, Sheet, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { useCreateLog, useDeleteLog, useFood, useUpdateLog } from "../../lib/queries.ts";
import { kcal, portion } from "../../lib/format.ts";
import { PortionEditor, type Portion } from "../food/PortionEditor.tsx";

/** Edit or delete one logged food. */
export function LogSheet({ log, onClose }: { log: FoodLogDTO | null; onClose: () => void }) {
  const food = useFood(log?.foodId ?? null);
  const update = useUpdateLog();
  const remove = useDeleteLog();
  const recreate = useCreateLog();
  const toast = useToast();
  const [portionState, setPortion] = useState<Portion | null>(null);
  const [meal, setMeal] = useState<MealTypeCode>("B");

  useEffect(() => {
    if (log) {
      setPortion({ measureId: log.measureId ?? "gen:g", quantity: log.quantity });
      setMeal(log.mealType);
    }
  }, [log]);

  if (!log) return null;
  const foodGone = !!log.foodId && food.isError;

  const save = async () => {
    if (!portionState) return;
    const changed = portionState.quantity !== log.quantity || portionState.measureId !== log.measureId;
    await update.mutateAsync({
      id: log.id,
      ...(changed ? { quantity: portionState.quantity, measureId: foodGone ? undefined : portionState.measureId } : {}),
      ...(meal !== log.mealType ? { mealType: meal } : {}),
    });
    onClose();
  };

  const del = async () => {
    await remove.mutateAsync(log.id);
    onClose();
    if (log.foodId && log.measureId) {
      const { foodId, measureId, quantity, date, mealType } = log;
      toast(`Removed ${log.foodName}`, {
        label: "Undo",
        run: () => recreate.mutate({ foodId, measureId, quantity, date, mealType, source: log.source }),
      });
    }
  };

  const dirty = portionState && (portionState.quantity !== log.quantity || portionState.measureId !== log.measureId || meal !== log.mealType);

  return (
    <Sheet open onClose={onClose} title={log.foodName}
      footer={
        <div className="flex gap-2">
          <Button variant="danger" onClick={del} disabled={remove.isPending} aria-label="Delete this entry"><Trash2 size={18} /> Delete</Button>
          <Button block onClick={save} disabled={!dirty || update.isPending}>Save</Button>
        </div>
      }>
      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium text-ink-2">Meal</span>
        <select value={meal} onChange={(e) => setMeal(e.target.value as MealTypeCode)}
          className="h-11 w-full rounded-xl border border-line bg-surface px-3">
          {MEAL_TYPES.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
        </select>
      </label>

      {food.isLoading && <Spinner />}
      {food.data && portionState && <PortionEditor food={food.data} value={portionState} onChange={setPortion} />}
      {(foodGone || !log.foodId) && portionState && (
        <div className="space-y-2">
          <p className="text-sm text-ink-3">This food is no longer in the database. You can still change how much you had.</p>
          <p className="num text-lg font-semibold">{portion(log.quantity, log.measureName)} · {kcal(log.nutrients.energy_kcal)} kcal</p>
          <input type="number" min={0.25} step={0.25} inputMode="decimal" aria-label="Quantity"
            value={portionState.quantity} onChange={(e) => setPortion({ ...portionState, quantity: Number(e.target.value) || 0.25 })}
            className="h-11 w-28 rounded-xl border border-line bg-surface px-3" />
        </div>
      )}
      {(update.error || remove.error) && <div className="mt-3"><ErrorNote error={update.error ?? remove.error} /></div>}
    </Sheet>
  );
}
