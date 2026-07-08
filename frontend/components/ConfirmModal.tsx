"use client";

import { useLocalization } from "@/lib/localization";

/**
 * Application-styled confirmation dialog (fixes12 §3.1) — replaces the native
 * browser confirm() so the text is localized and the look matches the app.
 */
export function ConfirmModal({
  message,
  detail,
  onConfirm,
  onCancel,
  busy = false,
}: {
  message: string;
  detail?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { t } = useLocalization();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-5 space-y-4">
        <h2 className="text-lg font-bold">{t("confirm.title", "אישור פעולה")}</h2>
        <p className="text-sm text-gray-700">{message}</p>
        {detail && <p className="text-sm font-medium">{detail}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-md bg-status-darkred text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {t("action.confirm", "אישור")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            {t("action.cancel", "ביטול")}
          </button>
        </div>
      </div>
    </div>
  );
}
