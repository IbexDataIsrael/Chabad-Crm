"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AreaPolygonMap } from "@/components/AreaPolygonMap";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Area } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

export default function EditAreaPage() {
  const { isAdmin, loading } = useAuth();
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
        setError(err instanceof Error ? err.message : "טעינת האזור נכשלה");
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
      setError(err instanceof Error ? err.message : "שמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !loaded) return <p className="text-gray-400">טוען…</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">עריכת אזור</h1>
        <Link
          href="/dashboard/areas"
          className="text-sm text-status-magenta hover:underline"
        >
          ← חזרה לאזורים
        </Link>
      </div>

      <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">כותרת</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">הערות</span>
          <textarea
            className={inputClass}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="space-y-1">
          <span className="block text-sm font-medium">תחום פוליגון</span>
          <AreaPolygonMap value={polygon} onChange={setPolygon} />
        </div>
        {error && <p className="text-sm text-status-darkred">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "שומר…" : "שמור"}
          </button>
          <Link
            href="/dashboard/areas"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            ביטול
          </Link>
        </div>
      </form>
    </div>
  );
}
