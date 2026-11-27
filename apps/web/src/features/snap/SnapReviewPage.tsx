import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import type { FoodDetailDTO, SnapImageDTO } from "../../../../../packages/shared/src/api.ts";
import { MEAL_TYPES, type MealTypeCode } from "../../../../../packages/shared/src/meals.ts";
import { Button, Card, cx, ErrorNote, IconButton, PageHeader, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { ApiImage } from "../../components/ApiImage.tsx";
import { toIso } from "../../lib/dates.ts";
import { kcal, portion as fmtPortion } from "../../lib/format.ts";
import { keys } from "../../lib/queries.ts";
import { portionNutrients } from "../food/PortionEditor.tsx";
import { SnapItemSheet, type ReviewItem } from "./SnapItemSheet.tsx";

function itemsFrom(snap: SnapImageDTO): ReviewItem[] {
  return snap.detections.map((d) => ({
    key: d.id,
    detectionId: d.id,
    label: d.label,
    localName: d.localName,
    confidence: d.confidence,
    bbox: d.bbox,
    foodId: d.food?.id ?? null,
    portion: d.measureId && d.quantity ? { measureId: d.measureId, quantity: d.quantity } : null,
    alternatives: d.alternatives,
    selected: d.selected,
  }));
}

/** Confirm detected foods: toggle, fix portions, swap foods, add missed items, then log. */
export function SnapReviewPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const snapQ = useQuery({ queryKey: ["snap", id], queryFn: () => api.snap(id) });
  const snap = snapQ.data;

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [editing, setEditing] = useState<ReviewItem | null>(null);
  const [meal, setMeal] = useState<MealTypeCode>("L");
  const [busy, setBusy] = useState<"track" | "retry" | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!snap) return;
    setItems(itemsFrom(snap));
    if (snap.mealType) setMeal(snap.mealType);
  }, [snap]);

  // Food details for live calorie totals.
  const foodIds = [...new Set(items.flatMap((i) => (i.foodId ? [i.foodId] : [])))];
  const details = useQueries({ queries: foodIds.map((fid) => ({ queryKey: keys.food(fid), queryFn: () => api.food(fid), staleTime: 300_000 })) });
  const byId = useMemo(() => new Map(details.flatMap((d) => (d.data ? [[d.data.id, d.data] as [string, FoodDetailDTO]] : []))), [details]);

  const priced = items.map((i) => {
    const food = i.foodId ? byId.get(i.foodId) : undefined;
    const p = food && i.portion ? portionNutrients(food, i.portion) : null;
    return { item: i, food, p };
  });
  const selected = priced.filter((x) => x.item.selected && x.food && x.item.portion);
  const total = selected.reduce((s, x) => s + (x.p?.nutrients.energy_kcal ?? 0), 0);
  const date = snap ? toIso(new Date(snap.capturedAt)) : toIso(new Date());

  const toggle = (key: string) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, selected: !x.selected && !!x.foodId } : x)));

  const track = async () => {
    setBusy("track");
    setError(null);
    try {
      const logs = await api.trackSnap(id, {
        date, mealType: meal,
        items: selected.map(({ item }) => ({ detectionId: item.detectionId, foodId: item.foodId!, measureId: item.portion!.measureId, quantity: item.portion!.quantity })),
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ["snap"] }), qc.invalidateQueries({ queryKey: ["diary"] }),
        qc.invalidateQueries({ queryKey: ["summary"] }), qc.invalidateQueries({ queryKey: ["recent"] })]);
      toast(`Logged ${logs.length} item${logs.length === 1 ? "" : "s"} to ${MEAL_TYPES.find((m) => m.code === meal)?.name}`);
      navigate(date === toIso(new Date()) ? "/" : `/?date=${date}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy("retry");
    setError(null);
    try {
      const fresh = await api.retrySnap(id);
      qc.setQueryData(["snap", id], fresh);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this photo? Foods you already logged stay in your diary.")) return;
    await api.deleteSnap(id);
    await qc.invalidateQueries({ queryKey: ["snap"] });
    navigate("/snap", { replace: true });
  };

  if (snapQ.isLoading) return <><PageHeader title="Snap" /><Spinner /></>;
  if (!snap) return <><PageHeader title="Snap" /><div className="p-4"><ErrorNote error={snapQ.error ?? "Not found"} /></div></>;

  const tracked = snap.status === "tracked";
  const numbered = priced.filter((x) => x.item.bbox);

  return (
    <div className="min-h-full pb-40">
      <PageHeader title={tracked ? "Logged meal" : "Confirm your meal"}
        right={<IconButton label="Delete photo" onClick={remove}><Trash2 size={20} /></IconButton>} />
      <div className="mx-auto max-w-xl space-y-3 px-4">
        <div className="relative overflow-hidden rounded-2xl bg-surface-2">
          <ApiImage src={snap.imageUrl} alt="Your meal" className="block w-full" />
          {numbered.map(({ item }, n) => (
            <button key={item.key} type="button" disabled={tracked} onClick={() => toggle(item.key)}
              aria-label={`${item.selected ? "Remove" : "Include"} item ${n + 1}`}
              className={cx("absolute rounded-lg border-2 transition", item.selected ? "border-food bg-food/10" : "border-dashed border-white/80 bg-black/20")}
              style={{ left: `${item.bbox!.x * 100}%`, top: `${item.bbox!.y * 100}%`, width: `${item.bbox!.w * 100}%`, height: `${item.bbox!.h * 100}%` }}>
              <span className={cx("absolute -left-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                item.selected ? "bg-food text-white" : "bg-white text-ink")}>{n + 1}</span>
            </button>
          ))}
        </div>

        {snap.provider === "mock" && <p className="text-center text-xs text-warn">Mock vision result (sample thali), not your photo.</p>}

        {snap.status === "failed" && (
          <Card className="space-y-3 p-4">
            <p className="flex gap-2 text-sm text-ink-2"><TriangleAlert size={18} className="shrink-0 text-warn" /> {snap.error}</p>
            <div className="flex gap-2">
              <Button onClick={retry} disabled={busy === "retry"}><RotateCcw size={18} /> {busy === "retry" ? "Trying…" : "Try again"}</Button>
              <Button variant="secondary" onClick={() => navigate(`/add?meal=${meal}&date=${date}`)}>Search instead</Button>
            </div>
          </Card>
        )}
        {snap.status === "no_food" && (
          <Card className="space-y-3 p-4">
            <p className="text-sm text-ink-2">We couldn't find any food in this photo.{snap.notes ? ` ${snap.notes}` : ""}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={retry} disabled={busy === "retry"}><RotateCcw size={18} /> Try again</Button>
              <Button onClick={() => setEditing({ key: `new-${Date.now()}`, label: null, localName: null, confidence: null, bbox: null, foodId: null, portion: null, alternatives: [], selected: true })}>
                <Plus size={18} /> Add food
              </Button>
            </div>
          </Card>
        )}

        {(snap.status === "detected" || tracked || items.length > 0) && snap.status !== "failed" && (
          <Card>
            <ul className="divide-y divide-line">
              {priced.map(({ item, food, p }) => {
                const n = numbered.findIndex((x) => x.item.key === item.key);
                return (
                  <li key={item.key} className="flex items-center gap-3 px-3 py-3">
                    {!tracked && (
                      <button type="button" role="checkbox" aria-checked={item.selected} disabled={!item.foodId}
                        aria-label={`Include ${food?.name ?? item.label}`} onClick={() => toggle(item.key)}
                        className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2",
                          item.selected ? "border-food bg-food text-white" : "border-line", !item.foodId && "opacity-40")}>
                        {item.selected && <Check size={14} strokeWidth={3} />}
                      </button>
                    )}
                    {n >= 0 && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-bold text-ink-2">{n + 1}</span>}
                    <button type="button" disabled={tracked} onClick={() => setEditing(item)} className="min-w-0 flex-1 text-left">
                      <span className={cx("block truncate font-medium", !food && "text-ink-3")}>{food?.name ?? (item.foodId ? "Loading…" : `“${item.label}” not found`)}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {p ? fmtPortion(item.portion!.quantity, p.measure.name, p.measure.id === "gen:g" ? undefined : p.weightG) : !item.foodId ? "Tap to search" : ""}
                        {item.label && food && item.label.toLowerCase() !== food.name.toLowerCase() ? ` · seen as “${item.label}”` : ""}
                        {item.confidence !== null && item.confidence < 0.5 ? " · unsure" : ""}
                      </span>
                    </button>
                    {food?.dataQuality && <TriangleAlert size={16} className="shrink-0 text-warn" aria-label="Calories may be overstated" />}
                    <span className={cx("num shrink-0 font-semibold", !item.selected && "text-ink-3 line-through")}>{p ? kcal(p.nutrients.energy_kcal) : "–"}</span>
                  </li>
                );
              })}
            </ul>
            {!tracked && (
              <button type="button" className="flex w-full items-center justify-center gap-1 border-t border-line py-3 text-sm font-semibold text-brand"
                onClick={() => setEditing({ key: `new-${Date.now()}`, label: null, localName: null, confidence: null, bbox: null, foodId: null, portion: null, alternatives: [], selected: true })}>
                <Plus size={16} /> Add something we missed
              </button>
            )}
          </Card>
        )}
        {snap.notes && snap.status === "detected" && <p className="px-1 text-xs text-ink-3">Note from the model: {snap.notes}</p>}
        {tracked && <Link to={`/?date=${date}`} className="block text-center font-semibold text-brand">View in diary</Link>}
        {error ? <ErrorNote error={error} /> : null}
      </div>

      {!tracked && snap.status !== "failed" && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface">
          <div className="mx-auto max-w-xl space-y-2 px-4 py-3">
            <div className="no-scrollbar flex gap-2 overflow-x-auto" role="radiogroup" aria-label="Meal">
              {MEAL_TYPES.map((m) => (
                <button key={m.code} type="button" role="radio" aria-checked={meal === m.code} onClick={() => setMeal(m.code)}
                  className={cx("shrink-0 rounded-full px-3 py-1 text-xs", meal === m.code ? "bg-ink font-semibold text-bg" : "bg-surface-2 text-ink-2")}>
                  {m.name}
                </button>
              ))}
            </div>
            <Button block onClick={track} disabled={!selected.length || busy === "track"} className="bg-food text-white">
              {busy === "track" ? "Logging…" : `Log ${selected.length} item${selected.length === 1 ? "" : "s"} · ${kcal(total)} kcal`}
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <SnapItemSheet item={editing} onClose={() => setEditing(null)}
          onSave={(next) => {
            setItems((xs) => (xs.some((x) => x.key === next.key) ? xs.map((x) => (x.key === next.key ? next : x)) : [...xs, next]));
            setEditing(null);
          }} />
      )}
    </div>
  );
}
