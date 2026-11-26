import { TriangleAlert } from "lucide-react";
import type { FoodSummaryDTO } from "../../../../../packages/shared/src/api.ts";
import { VegMark } from "../../components/ui.tsx";
import { kcal, portion, SOURCE_LABEL } from "../../lib/format.ts";

export function FoodRow({ food, onSelect, hint }: { food: FoodSummaryDTO; onSelect: () => void; hint?: string }) {
  const m = food.defaultMeasure;
  const serving = m && m.id !== "gen:g" ? portion(food.defaultQuantity, m.name, m.weightG * food.defaultQuantity) : "100 g";
  const meta = [food.brand, hint ?? SOURCE_LABEL[food.source] ?? food.source].filter(Boolean).join(" · ");
  return (
    <li>
      <button type="button" onClick={onSelect} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
        <VegMark isVeg={food.isVeg} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-medium leading-snug">{food.name}</p>
          <p className="truncate text-xs text-ink-3">{serving} · {meta}</p>
        </div>
        {food.dataQuality && <TriangleAlert size={16} className="shrink-0 text-warn" aria-label="Calories may be overstated" />}
        <div className="shrink-0 text-right">
          <p className="num font-semibold">{kcal(food.kcalPerDefault)}</p>
          <p className="text-[11px] text-ink-3">kcal</p>
        </div>
      </button>
    </li>
  );
}
