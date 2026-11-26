import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  ACTIVITY_LABELS, goalsFromProfile, type Activity, type GoalDirection, type MacroGoals, type Profile,
} from "../../../../../packages/shared/src/goals.ts";
import { Button, Card, cx, ErrorNote, PageHeader, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { today } from "../../lib/dates.ts";
import { kcal } from "../../lib/format.ts";
import { useInvalidateSettings, useSettings } from "../../lib/queries.ts";

const DEFAULT_PROFILE: Profile = { sex: "female", age: 30, heightCm: 160, weightKg: 65, activity: "light", goal: "maintain" };

/** One-screen goal setup: profile → suggested targets → editable numbers. */
export function GoalsPage() {
  const settings = useSettings(today());
  const invalidate = useInvalidateSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [goals, setGoals] = useState<MacroGoals | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    if (settings.data.profile) setProfile(settings.data.profile);
    setGoals(settings.data.goalsAreDefault ? goalsFromProfile(settings.data.profile ?? DEFAULT_PROFILE) : settings.data.goals);
  }, [settings.data]);

  const updateProfile = (patch: Partial<Profile>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    setGoals(goalsFromProfile(next));
  };

  const macroKcal = goals ? goals.protein_g * 4 + goals.carbs_g * 4 + goals.fat_g * 9 : 0;
  const mismatch = goals ? Math.abs(macroKcal - goals.calories) > goals.calories * 0.1 : false;

  const save = async () => {
    if (!goals) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveProfile(profile);
      await api.saveGoals(goals, today());
      await invalidate();
      toast("Goals saved");
      navigate(-1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!settings.data || !goals) return <><PageHeader title="Daily goals" /><Spinner /></>;

  return (
    <div className="min-h-full">
      <PageHeader title="Daily goals" />
      <div className="mx-auto max-w-xl space-y-3 px-4 pb-10">
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">About you</h2>
          <Choice label="Sex" value={profile.sex} options={[["female", "Female"], ["male", "Male"]]} onChange={(sex) => updateProfile({ sex })} />
          <div className="grid grid-cols-3 gap-3">
            <Num label="Age" value={profile.age} onChange={(age) => updateProfile({ age })} />
            <Num label="Height (cm)" value={profile.heightCm} onChange={(heightCm) => updateProfile({ heightCm })} />
            <Num label="Weight (kg)" value={profile.weightKg} onChange={(weightKg) => updateProfile({ weightKg })} />
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink-2">Activity</span>
            <select className="input" value={profile.activity} onChange={(e) => updateProfile({ activity: e.target.value as Activity })}>
              {Object.entries(ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <Choice label="Goal" value={profile.goal}
            options={[["lose", "Lose weight"], ["maintain", "Maintain"], ["gain", "Gain weight"]]}
            onChange={(goal: GoalDirection) => updateProfile({ goal })} />
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Your targets</h2>
            <span className="text-xs text-ink-3">Edit any number</span>
          </div>
          <Num label="Calories (kcal)" value={goals.calories} onChange={(calories) => setGoals({ ...goals, calories })} />
          <div className="grid grid-cols-2 gap-3">
            <Num label="Protein (g)" value={goals.protein_g} onChange={(protein_g) => setGoals({ ...goals, protein_g })} />
            <Num label="Carbs (g)" value={goals.carbs_g} onChange={(carbs_g) => setGoals({ ...goals, carbs_g })} />
            <Num label="Fat (g)" value={goals.fat_g} onChange={(fat_g) => setGoals({ ...goals, fat_g })} />
            <Num label="Fibre (g)" value={goals.fibre_g} onChange={(fibre_g) => setGoals({ ...goals, fibre_g })} />
          </div>
          <p className={cx("text-xs", mismatch ? "text-warn" : "text-ink-3")}>
            Macros add up to {kcal(macroKcal)} kcal{mismatch ? `, which is more than 10% off your calorie target.` : "."}
          </p>
        </Card>
        <p className="px-1 text-xs text-ink-3">
          Estimated with the Mifflin-St Jeor equation. General guidance, not medical advice. Talk to a doctor or dietitian for
          pregnancy, diabetes or other conditions.
        </p>
        {error ? <ErrorNote error={error} /> : null}
        <Button block onClick={save} disabled={busy}>Save goals (from today)</Button>
      </div>
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-ink-2">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={cx("rounded-full border px-3 py-1.5 text-sm", value === v ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line text-ink-2")}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }): ReactNode {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-2">{label}</span>
      <input inputMode="decimal" className="input num" value={Number.isFinite(value) ? value : ""}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}
