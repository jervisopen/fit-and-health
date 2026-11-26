import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { CustomFoodBody } from "../../../../../packages/shared/src/api.ts";
import type { NutrientKey, NutrientValues } from "../../../../../packages/shared/src/nutrients.ts";
import { Button, Card, cx, ErrorNote, PageHeader, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { keys, useFood } from "../../lib/queries.ts";

const FIELDS: { key: NutrientKey; label: string; unit: string; required?: boolean }[] = [
  { key: "energy_kcal", label: "Calories", unit: "kcal", required: true },
  { key: "protein_g", label: "Protein", unit: "g" },
  { key: "carbs_g", label: "Carbs", unit: "g" },
  { key: "fat_g", label: "Fat", unit: "g" },
  { key: "fibre_g", label: "Fibre", unit: "g" },
  { key: "sugar_g", label: "Sugar", unit: "g" },
  { key: "sodium_mg", label: "Sodium", unit: "mg" },
];

const SERVING_SUGGESTIONS = ["serving", "bowl", "katori", "plate", "piece", "glass", "cup", "pack"];

type Form = { name: string; brand: string; isVeg: "veg" | "nonveg" | ""; servingName: string; servingWeightG: string; values: Record<string, string> };
const empty = (name = ""): Form => ({ name, brand: "", isVeg: "", servingName: "serving", servingWeightG: "100", values: {} });

/** Create or edit a food by its nutrition label (per serving); stored per 100 g. */
export function CustomFoodPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const existing = useFood(id ?? null);
  const [form, setForm] = useState<Form>(() => empty(params.get("name") ?? ""));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const f = existing.data;
    if (!f) return;
    const serving = f.measures.find((m) => m.kind === "food") ?? { name: "serving", weightG: 100 };
    const values: Record<string, string> = {};
    for (const { key } of FIELDS) {
      const v = f.per100g[key];
      if (v !== undefined) values[key] = String(Math.round(((v * serving.weightG) / 100) * 10) / 10);
    }
    setForm({ name: f.name, brand: f.brand ?? "", isVeg: f.isVeg === null ? "" : f.isVeg ? "veg" : "nonveg",
      servingName: serving.name, servingWeightG: String(serving.weightG), values });
  }, [existing.data]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setError(null);
    const perServing: NutrientValues = {};
    for (const { key } of FIELDS) {
      const raw = form.values[key]?.trim();
      if (raw) perServing[key] = Number(raw.replace(",", "."));
    }
    const body: CustomFoodBody = {
      name: form.name, brand: form.brand || undefined, isVeg: form.isVeg ? form.isVeg === "veg" : undefined,
      servingName: form.servingName, servingWeightG: Number(form.servingWeightG), perServing,
    };
    setBusy(true);
    try {
      const saved = id ? await api.updateCustomFood(id, body) : await api.createCustomFood(body);
      await Promise.all([qc.invalidateQueries({ queryKey: keys.custom }), qc.invalidateQueries({ queryKey: keys.food(saved.id) }),
        qc.invalidateQueries({ queryKey: ["search"] })]);
      toast(id ? "Food updated" : "Food created");
      const ret = params.get("return");
      if (ret) navigate(`${ret}${ret.includes("?") ? "&" : "?"}open=${encodeURIComponent(saved.id)}`, { replace: true });
      else navigate("/foods", { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const valid = form.name.trim().length >= 2 && Number(form.servingWeightG) > 0 && Number(form.values.energy_kcal) >= 0 && form.values.energy_kcal?.trim();

  return (
    <div className="min-h-full">
      <PageHeader title={id ? "Edit food" : "New food"} />
      {id && existing.isLoading ? <Spinner /> : (
        <form className="mx-auto max-w-xl space-y-3 px-4 pb-10" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Card className="space-y-3 p-4">
            <Field label="Name"><input required minLength={2} value={form.name} onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Mom's poha" className="input" /></Field>
            <Field label="Brand (optional)"><input value={form.brand} onChange={(e) => set({ brand: e.target.value })} className="input" /></Field>
            <div role="radiogroup" aria-label="Diet" className="flex gap-2">
              {([["veg", "Veg"], ["nonveg", "Non-veg"], ["", "Not set"]] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={form.isVeg === v} onClick={() => set({ isVeg: v })}
                  className={cx("rounded-full border px-3 py-1.5 text-sm", form.isVeg === v ? "border-brand bg-brand-soft text-brand font-semibold" : "border-line text-ink-2")}>
                  {label}
                </button>
              ))}
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="font-semibold">Serving</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unit name">
                <input required list="serving-names" value={form.servingName} onChange={(e) => set({ servingName: e.target.value })} className="input" />
                <datalist id="serving-names">{SERVING_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
              </Field>
              <Field label="Weight of 1 unit (g)">
                <input required inputMode="decimal" value={form.servingWeightG} onChange={(e) => set({ servingWeightG: e.target.value })} className="input num" />
              </Field>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold">Nutrition for 1 {form.servingName || "serving"}</h2>
            <p className="mb-3 text-xs text-ink-3">Copy from the label. Only calories are required.</p>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label} (${f.unit})`}>
                  <input inputMode="decimal" required={f.required} value={form.values[f.key] ?? ""}
                    onChange={(e) => set({ values: { ...form.values, [f.key]: e.target.value } })} className="input num" />
                </Field>
              ))}
            </div>
          </Card>

          {error ? <ErrorNote error={error} /> : null}
          <Button type="submit" block disabled={!valid || busy}>{id ? "Save changes" : "Create food"}</Button>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}
