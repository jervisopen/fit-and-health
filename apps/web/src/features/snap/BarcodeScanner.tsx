import { useEffect, useRef, useState } from "react";
import { Sheet } from "../../components/ui.tsx";
import { api, ApiError } from "../../lib/api.ts";

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/** The Barcode Detection API (Chrome on Android, some desktop browsers); not available in Safari or Firefox. */
export function barcodeScanSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
}

/** Live camera barcode scan → local database → Open Food Facts lookup. */
export function BarcodeScanner({ onFound, onClose }: { onFound: (foodId: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("Point the camera at the barcode");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let looking = false;
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });

    const tick = async () => {
      if (stopped || !video.current) return;
      if (!looking && video.current.readyState >= 2) {
        const codes = await detector.detect(video.current).catch(() => []);
        const code = codes[0]?.rawValue;
        if (code && /^\d{8,14}$/.test(code)) {
          looking = true;
          setMessage(`Found ${code}. Looking it up…`);
          try {
            const food = await api.barcode(code);
            onFound(food.id);
            return;
          } catch (e) {
            setMessage(e instanceof ApiError && e.status === 404 ? `${code}: no nutrition facts found. Try another product or search by name.` : (e as Error).message);
            window.setTimeout(() => { looking = false; }, 2500);
          }
        }
      }
      window.setTimeout(tick, 250);
    };

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        void tick();
      })
      .catch(() => setMessage("Camera permission is needed to scan. You can also type the number on the Add food screen."));

    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onFound]);

  return (
    <Sheet open onClose={onClose} title="Scan barcode">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={video} muted playsInline className="aspect-[4/3] w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80" aria-hidden="true" />
      </div>
      <p role="status" className="mt-3 text-center text-sm text-ink-2">{message}</p>
    </Sheet>
  );
}
