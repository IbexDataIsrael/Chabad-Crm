"use client";

import { useEffect, useRef, useState } from "react";

import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";

/**
 * An always-visible text input that saves itself: on click-away (blur) or
 * Enter, if the value changed. Escape reverts. No Save button. A failed save
 * shows the error and goes back to the stored value. A short ✓ confirms.
 * Empty saves as null unless `required` (then refused and reverted).
 */
export function AutoSaveInput({
  value,
  onSave,
  required = false,
  requiredMessage,
  className = "",
  ...rest
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
  required?: boolean;
  requiredMessage?: string;
  className?: string;
  dir?: "rtl" | "ltr";
  placeholder?: string;
  "aria-label"?: string;
}) {
  const { t } = useLocalization();
  const { error: toastError } = useToast();
  const stored = value ?? "";
  const [draft, setDraft] = useState(stored);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const focused = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the stored value (e.g. after a reload) unless the user is typing.
  useEffect(() => {
    if (!focused.current) setDraft(stored);
  }, [stored]);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  async function commit() {
    const next = draft.trim();
    if (next === stored.trim()) {
      setDraft(stored);
      return;
    }
    if (required && next === "") {
      toastError(requiredMessage ?? t("pl.label_required", "יש להזין תווית בעברית"));
      setDraft(stored);
      return;
    }
    setState("saving");
    try {
      await onSave(next === "" ? null : next);
      setDraft(next);
      setState("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setDraft(stored);
      setState("idle");
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <input
        {...rest}
        className={`w-full rounded-md border px-2 py-1 text-sm transition-colors ${
          state === "saved" ? "border-status-green" : "border-input"
        } ${state === "saving" ? "opacity-60" : ""}`}
        value={draft}
        disabled={state === "saving"}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(stored);
            focused.current = false;
            // Blur after the revert lands, so commit sees the stored value.
            const el = e.target as HTMLInputElement;
            setTimeout(() => el.blur(), 0);
          }
        }}
      />
      {state === "saved" && (
        <span
          aria-label={t("msg.saved", "נשמר בהצלחה")}
          title={t("msg.saved", "נשמר בהצלחה")}
          className="pointer-events-none absolute end-2 text-xs text-status-green"
        >
          ✓
        </span>
      )}
    </span>
  );
}
