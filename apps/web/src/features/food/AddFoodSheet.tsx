import { useEffect, useState } from "react";
import type { LogSource } from "../../../../../packages/shared/src/api.ts";
import type { MealTypeCode } from "../../../../../packages/shared/src/meals.ts";
import { Button, ErrorNote, Sheet, Spinner } from "../../components/ui.tsx";
import { useCreateLog, useFood } from "../../lib/queries.ts";
import { sourceLabel } from "../../lib/format.ts";
import { initialPortion, PortionEditor, type Portion } from "./PortionEditor.tsx";

export type PendingFood = { id: string; source: LogSource; last?: { measureId: string | null; quantity: number } };

/** Pick a portion of one food and add it to a meal. */
export function AddFoodSheet({ pending, date, mealType, mealName, onClose, onAdded }: {
  pending: PendingFood | null; date: string; mealType: MealTypeCode; mealName: string;
  onClose: () => void; onAdded: (name: string) => void;
}) {
  const food = useFood(pending?.id ?? null);
  const create = useCreateLog();
  const [p, setP] = useState<Portion | null>(null);

  useEffect(() => {
    if (food.data && pending) setP(initialPortion(food.data, pending.last));
    else setP(null);
  }, [food.data, pending]);

  if (!pending) return null;

  const add = async () => {
    if (!food.data || !p) return;
    await create.mutateAsync({ date, mealType, foodId: food.data.id, measureId: p.measureId, quantity: p.quantity, source: pending.source });
    onAdded(food.data.name);
  };

  return (
    <Sheet open onClose={onClose} title={food.data?.name ?? "Loading…"}
      footer={<Button block onClick={add} disabled={!p || create.isPending}>Add to {mealName}</Button>}>
      {food.isLoading && <Spinner />}
      {food.error && <ErrorNote error={food.error} />}
      {food.data && (
        <>
          <p className="-mt-1 mb-4 text-sm text-ink-3">
            {[food.data.brand, food.data.category === "Everyday staples" ? null : food.data.category, sourceLabel(food.data)].filter(Boolean).join(" · ")}
          </p>
          {p && <PortionEditor food={food.data} value={p} onChange={setP} />}
        </>
      )}
      {create.error && <div className="mt-3"><ErrorNote error={create.error} /></div>}
    </Sheet>
  );
}
