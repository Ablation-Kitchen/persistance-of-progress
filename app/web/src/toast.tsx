import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Show = (message: string) => void;

const ToastContext = createContext<Show>(() => {});

/** Brief messages at the bottom of the screen, e.g. a failed optimistic save (spec §10). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback<Show>((text) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(null), 4_000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-slot" role="status" aria-live="polite">
        {message && (
          <div className="toast">
            <span>{message}</span>
            <button type="button" className="linkbtn" onClick={() => setMessage(null)}>
              dismiss
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
