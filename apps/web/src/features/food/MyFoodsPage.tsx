import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Card, ErrorNote, IconButton, Spinner, VegMark } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { kcal } from "../../lib/format.ts";
import { keys } from "../../lib/queries.ts";

export function MyFoodsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: keys.custom, queryFn: api.customFoods });
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete “${name}”? Entries you already logged keep their values.`)) return;
    await api.deleteCustomFood(id);
    await Promise.all([qc.invalidateQueries({ queryKey: keys.custom }), qc.invalidateQueries({ queryKey: ["search"] })]);
    toast(`Deleted ${name}`);
  };

  return (
    <div className="safe-top px-4 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My foods</h1>
        <Link to="/foods/new" className="inline-flex h-10 items-center gap-1 rounded-xl bg-brand px-3 font-semibold text-brand-ink">
          <Plus size={18} /> New
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink-3">Home recipes and packaged foods you've added yourself.</p>
      <div className="mt-4">
        {isLoading && <Spinner />}
        {error && <ErrorNote error={error} />}
        {data && data.length === 0 && (
          <Card className="p-6 text-center text-ink-2">
            <p>No custom foods yet.</p>
            <Link to="/foods/new" className="mt-2 inline-block font-semibold text-brand">Create your first one</Link>
          </Card>
        )}
        {data && data.length > 0 && (
          <Card>
            <ul className="divide-y divide-line">
              {data.map((f) => (
                <li key={f.id} className="flex items-center gap-2 pr-2">
                  <button type="button" onClick={() => navigate(`/foods/edit/${encodeURIComponent(f.id)}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
                    <VegMark isVeg={f.isVeg} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{f.name}</span>
                      <span className="block text-xs text-ink-3">
                        1 {f.defaultMeasure?.name} · {Math.round(f.defaultMeasure?.weightG ?? 0)} g · {kcal(f.kcalPerDefault)} kcal
                      </span>
                    </span>
                  </button>
                  <IconButton label={`Delete ${f.name}`} onClick={() => remove(f.id, f.name)}><Trash2 size={18} /></IconButton>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
