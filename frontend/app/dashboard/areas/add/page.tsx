"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AreaPolygonMap } from "@/components/AreaPolygonMap";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export default function AddAreaPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const router = useRouter();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [polygon, setPolygon] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Non-admins can't create areas — bounce them back to the list.
  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard/areas");
  }, [loading, isAdmin, router]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiFetch("/api/areas", {
        method: "POST",
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

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.add_area", "אזור חדש")}</h1>
        <Link
          href="/dashboard/areas"
          className="text-sm text-status-magenta hover:underline"
        >
          {t("page.back_to_areas", "← חזרה לאזורים")}
        </Link>
      </div>

      <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("areas.area_name", "כותרת")}</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("areas.area_notes", "הערות")}</span>
          <textarea
            className={inputClass}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="space-y-1">
          <span className="block text-sm font-medium">{t("areas.area_polygon", "תחום פוליגון")}</span>
          <AreaPolygonMap value={polygon} onChange={setPolygon} />
        </div>
        {error && <p className="text-sm text-status-darkred">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
          </button>
          <Link
            href="/dashboard/areas"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            {t("action.cancel", "ביטול")}
          </Link>
        </div>
      </form>
    </div>
  );
}
