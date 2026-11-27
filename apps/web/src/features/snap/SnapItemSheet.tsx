import { useDeferredValue, useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { FoodDetailDTO, FoodSummaryDTO } from "../../../../../packages/shared/src/api.ts";
import { Button, cx, Sheet, Spinner, VegMark } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { kcal } from "../../lib/format.ts";
import { useFood } from "../../lib/queries.ts";
import { initialPortion, PortionEditor, type Portion } from "../food/PortionEditor.tsx";

export type ReviewItem = {
  key: string;
  detectionId?: string;
  label: string | null;
  localName: string | null;
  confidence: number | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  foodId: string | null;
  portion: Portion | null;
  alternatives: FoodSummaryDTO[];
  selected: boolean;
};

/** Keep roughly the same amount when swapping foods: same unit name if it exists, else grams. */
function carryPortion(from: { weightG: number; unitName: string; quantity: number } | null, to: FoodDetailDTO): Portion {
  if (!from) return initialPortion(to);
  const same = to.measures.find((m) => m.name === from.unitName && m.id !== "gen:g");
  if (same) return { measureId: same.id, quantity: from.quantity };
  return { measureId: "gen:g", quantity: Math.max(5, Math.round(from.weightG / 5) * 5) };
}

/** Edit one detected item: fix the portion, or swap the food for an alternative or a search result. */
export function SnapItemSheet({ item, onSave, onClose }: { item: ReviewItem; onSave: (i: ReviewItem) => void; onClose: () => void }) {
  const [foodId, setFoodId] = useState<string | null>(item.foodId);
  const [portion, setPortion] = useState<Portion | null>(item.portion);
  const [searching, setSearching] = useState(!item.foodId);
  const [q, setQ] = useState(item.foodId ? "" : item.label ?? "");
  const deferred = useDeferredValue(q.trim());
  const food = useFood(foodId);
  const results = useQuery({
    queryKey: ["search", deferred, ""], queryFn: () => api.searchFoods(deferred),
    enabled: searching && deferred.length >= 2, placeholderData: keepPreviousData,
  });

  // The portion always belongs to `portionFor`; when a different food loads, carry the amount over.
  const portionFor = useRef<string | null>(item.portion ? item.foodId : null);
  const carry = useRef<{ weightG: number; unitName: string; quantity: number } | null>(null);
  useEffect(() => {
    if (!food.data || portionFor.current === food.data.id) return;
    setPortion(carryPortion(carry.current, food.data));
    portionFor.current = food.data.id;
  }, [food.data]);

  const choose = (f: FoodSummaryDTO) => {
    const current = food.data && portion ? food.data.measures.find((m) => m.id === portion.measureId) : null;
    carry.current = current && portion ? { weightG: current.weightG * portion.quantity, unitName: current.name, quantity: portion.quantity } : null;
    setFoodId(f.id);
    setSearching(false);
  };

  return (
    <Sheet open onClose={onClose} title={food.data?.name ?? (item.label ? `Find “${item.label}”` : "Add a food")}
      footer={<Button block disabled={!foodId || !portion || !food.data || portionFor.current !== foodId}
        onClick={() => onSave({ ...item, foodId, portion, selected: true })}>Done</Button>}>
      {item.label && (
        <p className="-mt-1 mb-3 text-sm text-ink-3">
          Detected “{item.label}”{item.localName ? ` (${item.localName})` : ""}{item.confidence !== null ? ` · ${Math.round(item.confidence * 100)}% sure` : ""}
        </p>
      )}

      {!searching && food.data && portion && <PortionEditor food={food.data} value={portion} onChange={setPortion} />}
      {!searching && food.isLoading && <Spinner />}

      {!searching && (
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium text-ink-2">Not the right food?</p>
          <div className="flex flex-wrap gap-2">
            {item.alternatives.filter((a) => a.id !== foodId).map((a) => (
              <button key={a.id} type="button" onClick={() => choose(a)} className="rounded-full border border-line px-3 py-1.5 text-left text-sm">
                {a.name}
              </button>
            ))}
            <button type="button" onClick={() => setSearching(true)} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold text-brand">
              <Search size={14} /> Search
            </button>
          </div>
        </div>
      )}

      {searching && (
        <div>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search foods" aria-label="Search foods"
              className="h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-3 outline-none focus:border-brand" />
          </div>
          <ul className={cx("mt-2 divide-y divide-line", results.isPlaceholderData && "opacity-60")}>
            {results.data?.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => choose(f)} className="flex w-full items-center gap-3 py-3 text-left">
                  <VegMark isVeg={f.isVeg} />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="num text-sm text-ink-3">{kcal(f.kcalPerDefault)} kcal</span>
                </button>
              </li>
            ))}
          </ul>
          {results.data?.length === 0 && <p className="py-4 text-center text-sm text-ink-3">No match. Try a simpler name.</p>}
          {foodId && <button type="button" className="mt-3 text-sm font-semibold text-brand" onClick={() => setSearching(false)}>Back to portion</button>}
        </div>
      )}
    </Sheet>
  );
}
