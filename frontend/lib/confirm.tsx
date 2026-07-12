"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ConfirmModal } from "@/components/ConfirmModal";

export interface ConfirmOptions {
  message: string;
  detail?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

/**
 * App-wide replacement for the native confirm() (fixes17 §1.2): one provider
 * renders the styled ConfirmModal, and `useConfirm()` hands components a
 * promise-based `confirmDialog({message, detail})`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      // A second dialog while one is open cancels the first (can't stack).
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setOpts(options);
    });
  }, []);

  function settle(ok: boolean) {
    setOpts(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <ConfirmModal
          message={opts.message}
          detail={opts.detail}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
