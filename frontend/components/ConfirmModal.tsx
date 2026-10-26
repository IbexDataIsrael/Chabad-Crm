"use client";

import { useLocalization } from "@/lib/localization";
import { Button } from "@/components/ui/button";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="glass-card w-full max-w-sm p-5 space-y-4">
        <h2 className="text-lg font-bold">{t("confirm.title", "אישור פעולה")}</h2>
        <p className="text-sm text-foreground">{message}</p>
        {detail && <p className="text-sm font-medium">{detail}</p>}
        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
            {t("action.confirm", "אישור")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("action.cancel", "ביטול")}
          </Button>
        </div>
      </div>
    </div>
  );
}
