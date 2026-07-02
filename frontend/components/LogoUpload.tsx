"use client";

import { useState, type ChangeEvent } from "react";

import { uploadLogo } from "@/lib/api";
import { useLocalization } from "@/lib/localization";

/**
 * Organization logo picker. Always a file **upload**: the chosen image is sent
 * to our backend, which stores it on Cloudinary and returns the URL. The value
 * is that Cloudinary URL (or null) — no data URLs, no URL pasting.
 */
export function LogoUpload({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const { t } = useLocalization();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      onChange(await uploadLogo(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("logo.upload_failed", "העלאת הלוגו נכשלה"));
    } finally {
      setBusy(false);
      e.target.value = ""; // allow re-picking the same file
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={t("logo.alt", "לוגו הארגון")}
            className="h-12 w-12 rounded object-contain border border-gray-200 bg-white"
          />
        ) : (
          <div className="h-12 w-12 rounded border border-dashed border-gray-300 flex items-center justify-center text-gray-300 text-xl">
            🏢
          </div>
        )}

        <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
          {busy
            ? t("action.saving", "מעלה…")
            : value
              ? t("logo.replace", "החלף לוגו")
              : t("logo.upload", "העלה לוגו")}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFile}
            disabled={busy}
          />
        </label>

        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-status-darkred hover:underline"
          >
            {t("action.clear", "הסר")}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-status-darkred">{error}</p>}
    </div>
  );
}
