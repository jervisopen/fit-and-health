import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; text: string; action?: { label: string; run: () => void } };
const Ctx = createContext<(text: string, action?: Toast["action"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string, action?: Toast["action"]) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, action });
    // Toasts with an action (Undo) stay longer so there's time to reach the button.
    timer.current = window.setTimeout(() => setToast(null), action ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
        {toast && (
          <div key={toast.id} className="animate-fade pointer-events-auto flex items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-bg shadow-lg">
            <span>{toast.text}</span>
            {toast.action && (
              <button type="button" className="font-semibold underline" onClick={() => { toast.action!.run(); setToast(null); }}>
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
