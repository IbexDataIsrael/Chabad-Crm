"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "success" | "error";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  /** Show a toast. Defaults to a success message. */
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const AUTO_DISMISS_MS = 2800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "success") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, kind }]);
      setTimeout(() => remove(id), AUTO_DISMISS_MS);
    },
    [remove],
  );

  const value: ToastContextValue = {
    toast,
    success: (m) => toast(m, "success"),
    error: (m) => toast(m, "error"),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Fixed stack, top-center; works for both RTL and LTR. */}
      <div className="fixed top-4 inset-x-0 z-50 flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            onClick={() => remove(t.id)}
            className={`pointer-events-auto cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg transition ${
              t.kind === "success" ? "bg-status-green" : "bg-status-darkred"
            }`}
          >
            {t.kind === "success" ? "✓ " : "✕ "}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
