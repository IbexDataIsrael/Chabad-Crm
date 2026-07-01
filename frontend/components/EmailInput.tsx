"use client";

import { useEffect } from "react";

import { useLocalization } from "@/lib/localization";
import { EMAIL_HINT, isValidEmail } from "@/lib/validation";

const baseClass =
  "w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-1";

/**
 * Reusable email input with instant (on-type) validation. Turns red once the
 * value is non-empty but malformed, and only shows the hint then (to stay quiet
 * while typing a valid address). Reports validity via `onValidityChange`.
 */
export function EmailInput({
  value,
  onChange,
  onValidityChange,
  required,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  onValidityChange?: (valid: boolean) => void;
  required?: boolean;
  id?: string;
}) {
  const { t } = useLocalization();
  const empty = value.trim().length === 0;
  const valid = !empty && isValidEmail(value);
  const invalid = !empty && !valid;

  useEffect(() => {
    onValidityChange?.(empty ? !required : valid);
  }, [value, required, empty, valid, onValidityChange]);

  return (
    <div className="space-y-1">
      <input
        id={id}
        type="email"
        dir="ltr"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        className={`${baseClass} ${
          invalid
            ? "border-status-darkred focus:border-status-darkred focus:ring-status-darkred"
            : "border-gray-300 focus:border-status-magenta focus:ring-status-magenta"
        }`}
      />
      {invalid && (
        <span className="block text-xs text-status-darkred">
          {t("validation.email_hint", EMAIL_HINT)}
        </span>
      )}
    </div>
  );
}
