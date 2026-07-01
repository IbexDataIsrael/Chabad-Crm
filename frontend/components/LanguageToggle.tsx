"use client";

import { useLocalization } from "@/lib/localization";

/** Small he/en switch. Shows the language you'd switch *to*. */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, toggleLang } = useLocalization();
  return (
    <button
      type="button"
      onClick={toggleLang}
      aria-label="Toggle language"
      className={`rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 ${className}`}
    >
      {lang === "he" ? "English" : "עברית"}
    </button>
  );
}
