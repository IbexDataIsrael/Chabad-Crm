"use client";

import { useState, type ChangeEvent } from "react";

import { useLocalization } from "@/lib/localization";

/** Read an image File and return a downscaled PNG data URL (max 256px, keeps
 * aspect ratio + transparency). Runs entirely in the browser — no upload service
 * needed — so the stored value is the image itself, never a pasted URL. */
function fileToScaledDataUrl(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Organization logo picker. Always a file **upload**: the chosen image is read
 * and downscaled in the browser, then stored as a data URL. No external upload
 * service, no URL pasting. Value is the image data URL (or null).
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
      onChange(await fileToScaledDataUrl(file));
    } catch {
      setError(t("logo.upload_failed", "העלאת הלוגו נכשלה"));
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
