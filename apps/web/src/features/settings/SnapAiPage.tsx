import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Button, Card, cx, ErrorNote, PageHeader, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { API_MODE } from "../../lib/transport.ts";

type ProviderKey = "anthropic" | "openai" | "gemini" | "openai_compatible" | "mock";

const PROVIDERS: { key: ProviderKey; name: string; model: string; keyUrl?: string; note: string }[] = [
  { key: "anthropic", name: "Claude (Anthropic)", model: "claude-opus-5-5", keyUrl: "https://console.anthropic.com/settings/keys", note: "The default, and the one fit&health is tested with most." },
  { key: "openai", name: "OpenAI", model: "", keyUrl: "https://platform.openai.com/api-keys", note: "Any vision-capable model." },
  { key: "gemini", name: "Google Gemini", model: "", keyUrl: "https://aistudio.google.com/apikey", note: "Google AI Studio keys include a free tier." },
  { key: "openai_compatible", name: "Other (OpenAI-compatible)", model: "", note: "OpenRouter, Groq, a local Ollama server, …" },
  { key: "mock", name: "Demo (no AI)", model: "", note: "Returns sample foods so you can try the flow." },
];
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"] as const;

/** Me → Snap AI: pick the vision provider and paste your own API key. */
export function SnapAiPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const current = useQuery({ queryKey: ["vision-settings"], queryFn: api.visionSettings });
  const [provider, setProvider] = useState<ProviderKey>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [effort, setEffort] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<unknown>(null);

  const saved = current.data?.saved ?? null;
  useEffect(() => {
    if (!saved) return;
    setProvider(saved.provider as ProviderKey);
    setModel(saved.model);
    setBaseURL(saved.baseURL);
    setEffort(saved.effort);
  }, [saved]);

  const p = PROVIDERS.find((x) => x.key === provider)!;
  const keyKept = saved?.hasKey && saved.provider === provider;
  const needsKey = provider !== "mock" && provider !== "openai_compatible";

  const canList = provider === "gemini" || provider === "openai" || provider === "openai_compatible";
  const loadModels = async () => {
    setModelsBusy(true);
    setModelsError(null);
    try {
      const res = await api.visionModels({ provider, apiKey: apiKey.trim() || undefined, baseURL: baseURL.trim() || undefined });
      setModels(res.models);
      if (!res.models.length) setModelsError(new Error("No models that can read photos were found for this key."));
      else if (!model.trim() || !res.models.some((m) => m.id === model.trim())) setModel(res.models[0]!.id);
    } catch (e) {
      setModelsError(e);
    } finally {
      setModelsBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveVisionSettings({
        provider,
        // Leaving the box empty keeps the saved key for the same provider.
        apiKey: apiKey.trim() ? apiKey.trim() : keyKept ? undefined : "",
        model: model.trim(),
        baseURL: baseURL.trim(),
        effort: provider === "anthropic" ? effort : "",
      });
      await qc.invalidateQueries({ queryKey: ["vision-settings"] });
      await qc.invalidateQueries({ queryKey: ["snap", "status"] });
      if (!res.status.configured) { setError(new Error(res.status.reason)); return; }
      toast("Snap AI saved");
      navigate(-1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh pb-10">
      <PageHeader title="Snap AI" />
      {current.isPending ? <Spinner /> : (
        <div className="mx-auto max-w-xl space-y-4 px-4">
          <p className="text-sm text-ink-2">
            Snap uses an AI vision model to recognise your plate. Bring your own API key; you pay the provider directly for each photo.
            {" "}
            {API_MODE === "local"
              ? "The key is saved only on this device, and photos go straight from your phone to the provider."
              : "The key is saved on your fit&health server."}
          </p>

          <Card>
            <fieldset>
              <legend className="sr-only">Provider</legend>
              {PROVIDERS.map((x) => (
                <label key={x.key} className="flex cursor-pointer items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <input type="radio" name="provider" className="mt-1 accent-[var(--brand)]" checked={provider === x.key}
                    onChange={() => { setProvider(x.key); setModel(""); setBaseURL(""); setApiKey(""); setModels(null); setModelsError(null); }} />
                  <span>
                    <span className="block font-medium">{x.name}</span>
                    <span className="block text-xs text-ink-3">{x.note}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </Card>

          {provider !== "mock" && (
            <Card className="space-y-4 p-4">
              <Field label={needsKey ? "API key" : "API key (if your server needs one)"}
                hint={keyKept ? "A key is saved. Leave this empty to keep it." : p.keyUrl ? <>Get one at <a className="text-brand underline" href={p.keyUrl} target="_blank" rel="noreferrer">{new URL(p.keyUrl).host}</a></> : undefined}>
                <input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder={keyKept ? "••••••••" : "Paste your key"} className={inputCls} />
              </Field>
              <Field label="Model" hint={p.model ? `Leave empty for ${p.model}` : canList ? "Tap “Show my models” to pick from the models your key can use." : undefined}>
                {models && models.length > 0 ? (
                  <select value={models.some((m) => m.id === model) ? model : ""} onChange={(e) => setModel(e.target.value)} className={inputCls}>
                    {!models.some((m) => m.id === model) && <option value="" disabled>Choose a model</option>}
                    {models.map((m) => <option key={m.id} value={m.id}>{m.label === m.id ? m.id : `${m.label} (${m.id})`}</option>)}
                  </select>
                ) : (
                  <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={p.model || "Model ID"} className={inputCls}
                    spellCheck={false} autoCapitalize="none" autoCorrect="off" />
                )}
              </Field>
              {canList && (
                <div className="-mt-2 space-y-2">
                  <Button variant="secondary" className="h-10 text-sm" disabled={modelsBusy} onClick={() => void loadModels()}>
                    {modelsBusy ? "Loading models…" : models ? "Reload my models" : "Show my models"}
                  </Button>
                  {modelsError ? <ErrorNote error={modelsError} /> : null}
                </div>
              )}
              {provider === "openai_compatible" && (
                <Field label="Base URL" hint="For example https://openrouter.ai/api/v1. The server must allow requests from this site (CORS).">
                  <input type="url" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://…/v1" className={inputCls} spellCheck={false} />
                </Field>
              )}
              {provider === "anthropic" && (
                <Field label="Effort" hint="Higher can be more accurate but is slower and costs more.">
                  <div className="flex flex-wrap gap-2">
                    {EFFORTS.map((e) => (
                      <button key={e} type="button" onClick={() => setEffort(e)}
                        className={cx("rounded-full px-3 py-1.5 text-sm", effort === e ? "bg-ink font-semibold text-bg" : "bg-surface-2 text-ink-2")}>
                        {e || "Default"}
                      </button>
                    ))}
                  </div>
                </Field>
              )}
            </Card>
          )}

          {error ? <ErrorNote error={error} /> : null}
          <Button block onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          {saved && (
            <Button block variant="danger" onClick={async () => {
              if (!confirm("Remove the Snap AI settings and key from this device?")) return;
              await api.clearVisionSettings();
              await qc.invalidateQueries({ queryKey: ["vision-settings"] });
              await qc.invalidateQueries({ queryKey: ["snap", "status"] });
              toast("Snap AI removed");
              navigate(-1);
            }}>Remove key</Button>
          )}
        </div>
      )}
    </div>
  );
}

const inputCls = "h-11 w-full rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-brand";

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}
