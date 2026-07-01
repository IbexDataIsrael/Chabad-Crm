"use client";

import { useState, type ChangeEvent } from "react";

import { cloudinaryConfigured, uploadToCloudinary } from "@/lib/cloudinary";
import { useLocalization } from "@/lib/localization";

/**
 * Organization logo picker. Uploads to Cloudinary (unsigned) when configured,
 * otherwise falls back to pasting an image URL so the field still works.
 * Value is the image URL (or null).
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
      onChange(await uploadToCloudinary(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("logo.upload_failed", "העלאת הלוגו נכשלה"));
    } finally {
      setBusy(false);
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

        {cloudinaryConfigured ? (
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
        ) : (
          <input
            dir="ltr"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
            placeholder={t("logo.url_placeholder", "הדבק כתובת תמונה (URL) של הלוגו")}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
          />
        )}

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
