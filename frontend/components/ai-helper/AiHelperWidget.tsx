"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useLocalization } from "@/lib/localization";
import { cn } from "@/lib/utils";
import { AiHelperPanel } from "./AiHelperPanel";

// fixes111: floating AI helper button + chat panel, mounted globally in
// app/providers.tsx. Esc or clicking outside the panel closes it.
export function AiHelperWidget() {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef}>
      {open && <AiHelperPanel onClose={() => setOpen(false)} />}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("ai_helper.title", "העוזר החכם")}
        aria-expanded={open}
        className={cn(
          "fixed bottom-4 end-4 z-50 flex h-12 w-12 items-center justify-center rounded-full",
          "bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90",
        )}
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    </div>
  );
}
