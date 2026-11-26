import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Barcode, Check, Plus, Search, X } from "lucide-react";
import { isMealType, MEAL_TYPES, closestMealType, type MealTypeCode } from "../../../../../packages/shared/src/meals.ts";
import { cx, ErrorNote, IconButton, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { isValidIso, relativeLabel, today } from "../../lib/dates.ts";
import { keys } from "../../lib/queries.ts";
import { FoodRow } from "./FoodRow.tsx";
import { AddFoodSheet, type PendingFood } from "./AddFoodSheet.tsx";

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Search the food database and add items to one meal; stays open for adding several. */
export function AddFoodPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const date = isValidIso(params.get("date")) ? params.get("date")! : today();
  const meal: MealTypeCode = isMealType(params.get("meal")) ? (params.get("meal") as MealTypeCode) : closestMealType(nowMinutes());
  const mealName = MEAL_TYPES.find((m) => m.code === meal)!.name;

  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const [pending, setPending] = useState<PendingFood | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [tab, setTab] = useState<"recent" | "mine">("recent");
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useQuery({
    queryKey: ["search", deferred, meal],
    queryFn: () => api.searchFoods(deferred, meal),
    enabled: deferred.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const recent = useQuery({ queryKey: keys.recent(meal), queryFn: () => api.recentFoods(meal) });
  const mine = useQuery({ queryKey: keys.custom, queryFn: api.customFoods, enabled: tab === "mine" });

  // A custom food just created from here opens straight in the add sheet.
  useEffect(() => {
    const open = params.get("open");
    if (open) {
      setPending({ id: open, source: "custom" });
      params.delete("open");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const setMeal = (m: MealTypeCode) => {
    params.set("meal", m);
    setParams(params, { replace: true });
  };

  const showingSearch = deferred.length >= 2;

  return (
    <div className="min-h-full">
      <header className="safe-top sticky top-0 z-20 bg-bg/95 backdrop-blur">
        <div className="mx-auto max-w-xl px-2 pt-2">
          <div className="flex items-center gap-1">
            <IconButton label="Back to diary" onClick={() => navigate(`/${date === today() ? "" : `?date=${date}`}`)}>
              <ArrowLeft size={22} />
            </IconButton>
            <div className="relative flex-1">
              <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input ref={inputRef} autoFocus type="search" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search dal, roti, Parle-G…" aria-label="Search foods"
                className="h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-10 text-base outline-none focus:border-brand" />
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-3">
                  <X size={18} />
                </button>
              )}
            </div>
            <IconButton label="Look up a barcode" onClick={() => setBarcodeOpen((v) => !v)}><Barcode size={22} /></IconButton>
          </div>
          <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto px-2 pb-2" role="radiogroup" aria-label="Meal">
            {MEAL_TYPES.map((m) => (
              <button key={m.code} type="button" role="radio" aria-checked={m.code === meal} onClick={() => setMeal(m.code)}
                className={cx("shrink-0 rounded-full px-3 py-1.5 text-sm",
                  m.code === meal ? "bg-ink text-bg font-semibold" : "bg-surface-2 text-ink-2")}>
                {m.name}
              </button>
            ))}
            <span className="shrink-0 self-center px-1 text-xs text-ink-3">{relativeLabel(date)}</span>
          </div>
          {barcodeOpen && <BarcodeLookup onFound={(id) => { setBarcodeOpen(false); setPending({ id, source: "barcode" }); }} />}
        </div>
      </header>

      <main className="mx-auto max-w-xl pb-28">
        {showingSearch ? (
          <section aria-label="Search results">
            {search.isLoading && <Spinner />}
            {search.error && <div className="p-4"><ErrorNote error={search.error} /></div>}
            {search.data && search.data.length === 0 && (
              <div className="px-4 py-8 text-center text-ink-2">
                <p>No match for “{deferred}”.</p>
                <Link to={`/foods/new?name=${encodeURIComponent(deferred)}&return=${encodeURIComponent(`/add?meal=${meal}&date=${date}`)}`}
                  className="mt-3 inline-flex items-center gap-1 font-semibold text-brand"><Plus size={18} /> Create “{deferred}”</Link>
              </div>
            )}
            <ul className={cx("divide-y divide-line", search.isPlaceholderData && "opacity-60")}>
              {search.data?.map((f) => <FoodRow key={f.id} food={f} onSelect={() => setPending({ id: f.id, source: "search" })} />)}
            </ul>
          </section>
        ) : (
          <section>
            <div className="flex gap-4 border-b border-line px-4" role="tablist">
              {(["recent", "mine"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={cx("-mb-px border-b-2 py-3 text-sm font-semibold", tab === t ? "border-brand text-brand" : "border-transparent text-ink-3")}>
                  {t === "recent" ? "Recent" : "My foods"}
                </button>
              ))}
            </div>
            {tab === "recent" && (
              recent.data?.length
                ? <ul className="divide-y divide-line">
                    {recent.data.map((f) => (
                      <FoodRow key={f.id} food={f} hint={`logged ${f.timesLogged}×`}
                        onSelect={() => setPending({ id: f.id, source: "recent", last: { measureId: f.lastMeasureId, quantity: f.lastQuantity } })} />
                    ))}
                  </ul>
                : recent.isLoading ? <Spinner /> : <p className="px-4 py-8 text-center text-ink-3">Foods you log will show up here.</p>
            )}
            {tab === "mine" && (
              <>
                <ul className="divide-y divide-line">
                  {mine.data?.map((f) => <FoodRow key={f.id} food={f} onSelect={() => setPending({ id: f.id, source: "custom" })} />)}
                </ul>
                {mine.data?.length === 0 && <p className="px-4 pt-8 text-center text-ink-3">No custom foods yet.</p>}
              </>
            )}
            <Link to={`/foods/new?return=${encodeURIComponent(`/add?meal=${meal}&date=${date}`)}`}
              className="mx-4 mt-4 flex items-center justify-center gap-2 rounded-xl border border-dashed border-line py-3 font-semibold text-brand">
              <Plus size={18} /> Create a custom food
            </Link>
          </section>
        )}
      </main>

      {added.length > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface">
          <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
            <Check size={20} className="text-brand" />
            <p className="min-w-0 flex-1 truncate text-sm"><b>{added.length} added</b> to {mealName}</p>
            <button type="button" className="h-11 rounded-xl bg-brand px-5 font-semibold text-brand-ink"
              onClick={() => navigate(`/${date === today() ? "" : `?date=${date}`}`)}>Done</button>
          </div>
        </div>
      )}

      <AddFoodSheet pending={pending} date={date} mealType={meal} mealName={mealName} onClose={() => setPending(null)}
        onAdded={(name) => { setPending(null); setAdded((a) => [...a, name]); toast(`Added ${name}`); }} />
    </div>
  );
}

function BarcodeLookup({ onFound }: { onFound: (foodId: string) => void }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const lookup = async () => {
    setState({ busy: true });
    try {
      const food = await api.barcode(code.trim());
      setState({ busy: false });
      onFound(food.id);
    } catch (e) {
      setState({ busy: false, error: e instanceof ApiError && e.status === 404 ? "No product with nutrition facts found for this barcode." : (e as Error).message });
    }
  };
  return (
    <form className="mx-2 mb-2 rounded-xl bg-surface-2 p-3" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
      <label className="text-sm font-medium text-ink-2" htmlFor="barcode">Barcode number</label>
      <div className="mt-1 flex gap-2">
        <input id="barcode" inputMode="numeric" pattern="\d{6,14}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="8901234567890" className="num h-11 flex-1 rounded-xl border border-line bg-surface px-3" />
        <button type="submit" disabled={code.length < 6 || state.busy} className="h-11 rounded-xl bg-brand px-4 font-semibold text-brand-ink disabled:opacity-50">
          {state.busy ? "…" : "Find"}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-3">Looks in your database first, then Open Food Facts. Camera scanning comes with Snap.</p>
      {state.error && <p role="alert" className="mt-1 text-sm text-over">{state.error}</p>}
    </form>
  );
}
