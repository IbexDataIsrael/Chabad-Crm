"use client";

import { useEffect } from "react";

import { useLocalization } from "@/lib/localization";
import { isValidPhone, PHONE_HINT } from "@/lib/validation";

const baseClass =
  "w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-1";

/**
 * Reusable phone input with instant (on-type) validation for Israeli or
 * USA/Canada numbers. Shows the hint in gray, and turns red once the value is
 * non-empty but invalid. Reports validity via `onValidityChange`.
 */
export function PhoneInput({
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
  const valid = !empty && isValidPhone(value);
  const invalid = !empty && !valid;

  useEffect(() => {
    // "Valid" for form purposes: optional+empty is fine; otherwise must pass.
    onValidityChange?.(empty ? !required : valid);
  }, [value, required, empty, valid, onValidityChange]);

  return (
    <div className="space-y-1">
      <input
        id={id}
        type="tel"
        dir="ltr"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        className={`${baseClass} ${
          invalid
            ? "border-status-darkred focus:border-status-darkred focus:ring-status-darkred"
            : "border-input focus:border-primary focus:ring-primary"
        }`}
      />
      <span className={`block text-xs ${invalid ? "text-status-darkred" : "text-muted-foreground"}`}>
        {t("validation.phone_hint", PHONE_HINT)}
      </span>
    </div>
  );
}
