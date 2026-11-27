import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Images, ScanBarcode, Sparkles } from "lucide-react";
import { closestMealType, MEAL_TYPES, type MealTypeCode } from "../../../../../packages/shared/src/meals.ts";
import { Card, cx, ErrorNote, Spinner } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { compressImage } from "../../lib/image.ts";
import { today } from "../../lib/dates.ts";
import { BarcodeScanner, barcodeScanSupported } from "./BarcodeScanner.tsx";

const nowMin = () => new Date().getHours() * 60 + new Date().getMinutes();

/** Capture or pick a meal photo; detection runs on the server with the configured vision model. */
export function SnapPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["snap", "status"], queryFn: api.snapStatus, staleTime: 60_000 });
  const recent = useQuery({ queryKey: ["snap", "list"], queryFn: api.snaps });
  const [meal, setMeal] = useState<MealTypeCode>(() => closestMealType(nowMin()));
  const [busy, setBusy] = useState<{ preview: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [scanning, setScanning] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const preview = URL.createObjectURL(file);
    setBusy({ preview });
    try {
      const image = await compressImage(file);
      const snap = await api.uploadSnap(image, {
        mealType: meal,
        mealName: MEAL_TYPES.find((m) => m.code === meal)?.name,
        capturedAt: file.lastModified && Date.now() - file.lastModified < 7 * 86_400_000 ? file.lastModified : Date.now(),
      });
      await qc.invalidateQueries({ queryKey: ["snap", "list"] });
      navigate(`/snap/${snap.id}`);
    } catch (e) {
      setError(e);
    } finally {
      URL.revokeObjectURL(preview);
      setBusy(null);
    }
  };

  const configured = status.data?.configured;

  return (
    <div className="safe-top px-4 pt-4">
      <h1 className="text-2xl font-bold">Snap</h1>
      <p className="text-sm text-ink-3">Photograph your plate. We'll find the foods and portions for you to confirm.</p>

      {status.data && !status.data.configured && (
        <Card className="mt-4 space-y-2 p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-food" /> Connect a vision model</h2>
          <p className="text-sm text-ink-2">{status.data.reason}</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs leading-relaxed">{`# .env (next to package.json)
VISION_PROVIDER=anthropic   # or openai, gemini, openai_compatible
VISION_API_KEY=...
VISION_MODEL=               # optional for anthropic (claude-opus-5-5)`}</pre>
          <p className="text-xs text-ink-3">Restart the server after editing .env. Your key stays on the server. To try the flow without a key, use <code>VISION_PROVIDER=mock</code>.</p>
        </Card>
      )}

      {busy ? (
        <Card className="mt-4 overflow-hidden">
          <img src={busy.preview} alt="Your meal" className="h-64 w-full object-cover" />
          <div className="flex items-center gap-3 p-4">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-food" />
            <div>
              <p className="font-semibold">Analysing your plate…</p>
              <p className="text-xs text-ink-3">Finding foods and estimating portions. This can take up to a minute.</p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4" role="radiogroup" aria-label="Meal">
            {MEAL_TYPES.map((m) => (
              <button key={m.code} type="button" role="radio" aria-checked={meal === m.code} onClick={() => setMeal(m.code)}
                className={cx("shrink-0 rounded-full px-3 py-1.5 text-sm", meal === m.code ? "bg-ink font-semibold text-bg" : "bg-surface-2 text-ink-2")}>
                {m.name}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <button type="button" disabled={!configured} onClick={() => cameraInput.current?.click()}
              className="flex flex-col items-center gap-2 rounded-2xl bg-food px-3 py-6 font-semibold text-white disabled:opacity-40">
              <Camera size={30} /> Take photo
            </button>
            <button type="button" disabled={!configured} onClick={() => galleryInput.current?.click()}
              className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-6 font-semibold disabled:opacity-40">
              <Images size={30} className="text-food" /> From gallery
            </button>
          </div>
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={galleryInput} type="file" accept="image/*" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />

          {barcodeScanSupported() && (
            <button type="button" onClick={() => setScanning(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm font-semibold text-ink-2">
              <ScanBarcode size={18} /> Scan a packaged food barcode
            </button>
          )}
          {status.data?.configured && status.data.provider === "mock" && (
            <p className="mt-2 text-center text-xs text-warn">Mock vision is on: every photo returns the same sample thali.</p>
          )}
        </>
      )}

      {error ? <div className="mt-3"><ErrorNote error={error} /></div> : null}

      <h2 className="mt-6 mb-2 font-semibold">Recent snaps</h2>
      {recent.isLoading && <Spinner />}
      {recent.data?.length === 0 && <p className="text-sm text-ink-3">Your meal photos will appear here.</p>}
      <ul className="grid grid-cols-3 gap-2">
        {recent.data?.map((s) => (
          <li key={s.id}>
            <Link to={`/snap/${s.id}`} className="relative block aspect-square overflow-hidden rounded-xl bg-surface-2">
              <img src={s.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              <span className={cx("absolute bottom-1 left-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                s.status === "tracked" ? "bg-fast text-fast-ink" : s.status === "failed" || s.status === "no_food" ? "bg-ink/70 text-bg" : "bg-food text-white")}>
                {s.status === "tracked" ? "Logged" : s.status === "detected" ? `${s.detections.length} found` : s.status === "no_food" ? "No food" : s.status === "failed" ? "Failed" : "…"}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {scanning && (
        <BarcodeScanner onClose={() => setScanning(false)}
          onFound={(foodId) => { setScanning(false); navigate(`/add?meal=${meal}&date=${today()}&open=${encodeURIComponent(foodId)}&source=barcode`); }} />
      )}
    </div>
  );
}
