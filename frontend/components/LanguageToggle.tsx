"use client";

import { useLocalization } from "@/lib/localization";

/** Small he/en switch. Shows the language you'd switch *to*.
 *  "lang.toggle" is seeded with hebrew_label="English"/english_label="עברית"
 *  (deliberately swapped) so t() always resolves to the *other* language's
 *  name regardless of which is currently active. */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { t, toggleLang } = useLocalization();
  return (
    <button
      type="button"
      onClick={toggleLang}
      aria-label="Toggle language"
      className={`min-h-[44px] rounded-md border border-input px-2 py-1 text-xs hover:bg-accent ${className}`}
    >
      {t("lang.toggle", "English")}
    </button>
  );
}
