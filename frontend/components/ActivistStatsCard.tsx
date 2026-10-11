"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { OrgActivistStats } from "@/lib/types";

/** fixes98: the numbers the "messages for activists" quote
 *  ({organization_name} / {number_of_apartments} / {number_of_jews}).
 *  Calculated once by the server on first use; editable here, and
 *  "recalculate" refreshes them from the live data. */
export function ActivistStatsCard() {
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [stats, setStats] = useState<OrgActivistStats | null>(null);
  const [name, setName] = useState("");
  const [apartments, setApartments] = useState("");
  const [jews, setJews] = useState("");
  const [busy, setBusy] = useState(false);

  function show(s: OrgActivistStats) {
    setStats(s);
    setName(s.organization_name);
    setApartments(String(s.number_of_apartments));
    setJews(String(s.number_of_jews));
  }

  useEffect(() => {
    apiFetch<OrgActivistStats>("/api/activist-messages/stats").then(show).catch(() => {});
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      show(
        await apiFetch<OrgActivistStats>("/api/activist-messages/stats", {
          method: "PUT",
          body: JSON.stringify({
            organization_name: name.trim(),
            number_of_apartments: Math.max(0, Math.floor(Number(apartments) || 0)),
            number_of_jews: Math.max(0, Math.floor(Number(jews) || 0)),
          }),
        }),
      );
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  async function recalculate() {
    setBusy(true);
    try {
      show(
        await apiFetch<OrgActivistStats>("/api/activist-messages/stats/recalculate", {
          method: "POST",
        }),
      );
      success(t("activist_stats.recalculated", "הנתונים חושבו מחדש"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-0">
      <form onSubmit={save} className="p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">
            {t("activist_stats.title", "נתונים להודעות לפעילים")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "activist_stats.hint",
              "הערכים שמוצגים בהודעות לפעילים במקום {organization_name}, {number_of_apartments} ו-{number_of_jews}. חושבו אוטומטית בפעם הראשונה; אפשר לערוך אותם או לחשב מחדש.",
            )}
          </p>
        </div>
        {stats === null ? (
          <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
        ) : (
          <>
            <label className="block space-y-1">
              <Label className="block text-sm font-medium">
                {t("activist_stats.organization_name", "שם הארגון")}
              </Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <Label className="block text-sm font-medium">
                  {t("activist_stats.number_of_apartments", "מספר דירות")}
                </Label>
                <Input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={apartments}
                  onChange={(e) => setApartments(e.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <Label className="block text-sm font-medium">
                  {t("activist_stats.number_of_jews", "מספר יהודים")}
                </Label>
                <Input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={jews}
                  onChange={(e) => setJews(e.target.value)}
                />
              </label>
            </div>
            {stats.calculated_at && (
              <p className="text-xs text-muted-foreground">
                {t("activist_stats.calculated_at", "חושב לאחרונה:")}{" "}
                <span dir="ltr">{new Date(stats.calculated_at).toLocaleString()}</span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void recalculate()}>
                <RefreshCw className="h-4 w-4" />
                {t("activist_stats.recalculate", "חישוב מחדש")}
              </Button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
}
