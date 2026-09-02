"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AreaPolygonMap } from "@/components/AreaPolygonMap";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import type { Area } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export default function EditAreaPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const areaId = params.id;

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [polygon, setPolygon] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Non-admins can't edit areas — bounce them back to the list.
  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard/areas");
  }, [loading, isAdmin, router]);

  // Load the existing area.
  useEffect(() => {
    if (loading || !isAdmin) return;
    apiFetch<Area>(`/api/areas/${areaId}`)
      .then((a) => {
        setName(a.area_name);
        setNotes(a.area_notes ?? "");
        setPolygon(a.area_polygon ?? null);
        setLoaded(true);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("msg.load_failed", "טעינה נכשלה"));
        setLoaded(true);
      });
  }, [areaId, loading, isAdmin]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiFetch(`/api/areas/${areaId}`, {
        method: "PUT",
        body: JSON.stringify({
          area_name: name,
          area_notes: notes || null,
          area_polygon: polygon,
        }),
      });
      router.push("/dashboard/areas");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !loaded) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.edit_area", "עריכת אזור")}</h1>
        <Link
          href="/dashboard/areas"
          className="flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("page.back_to_areas", "חזרה לאזורים")} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <Card className="p-4">
        <form onSubmit={save} className="space-y-3">
        <div className="space-y-1">
          <Label>{t("areas.area_name", "כותרת")}</Label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>{t("areas.area_notes", "הערות")}</Label>
          <textarea
            className={inputClass}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>{t("areas.area_polygon", "תחום פוליגון")}</Label>
          <AreaPolygonMap value={polygon} onChange={setPolygon} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/areas">{t("action.cancel", "ביטול")}</Link>
          </Button>
        </div>
        </form>
      </Card>
    </div>
  );
}
