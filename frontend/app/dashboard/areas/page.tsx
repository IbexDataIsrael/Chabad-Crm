"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { contactFullName, type Area, type Contact } from "@/lib/types";

export default function AreasPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [areas, setAreas] = useState<Area[]>([]);

  async function reload() {
    setAreas(await apiFetch<Area[]>("/api/areas"));
  }

  useEffect(() => {
    reload().catch(() => {});
  }, []);

  if (loading) return <p className="text-gray-400">טוען…</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("areas", "אזורים")}</h1>
        {isAdmin && (
          <Link
            href="/dashboard/areas/add"
            className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
          >
            הוסף אזור
          </Link>
        )}
      </div>
      <p className="text-sm text-gray-500">
        אזורים גאוגרפיים עם תחום פוליגון על המפה. השלוחים המכסים כל אזור מוצגים תחתיו.
      </p>

      <div className="space-y-3">
        {areas.map((a) => (
          <AreaCard key={a.id} area={a} isAdmin={isAdmin} onChanged={reload} />
        ))}
        {areas.length === 0 && (
          <p className="bg-white rounded-xl shadow-sm px-4 py-6 text-center text-gray-400">
            אין אזורים עדיין.
          </p>
        )}
      </div>
    </div>
  );
}

function AreaCard({
  area,
  isAdmin,
  onChanged,
}: {
  area: Area;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const [shluchim, setShluchim] = useState<Contact[] | null>(null);
  const [open, setOpen] = useState(false);

  async function toggleShluchim() {
    const next = !open;
    setOpen(next);
    if (next && shluchim === null) {
      try {
        setShluchim(await apiFetch<Contact[]>(`/api/areas/${area.id}/shluchim`));
      } catch {
        setShluchim([]);
      }
    }
  }

  async function remove() {
    if (!confirm(`למחוק את האזור '${area.area_name}'?`)) return;
    await apiFetch(`/api/areas/${area.id}`, { method: "DELETE" });
    await onChanged();
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{area.area_name}</span>
        {area.area_polygon ? (
          <span className="rounded bg-status-green/10 text-status-green text-xs px-2 py-0.5">
            תחום מוגדר
          </span>
        ) : (
          <span className="rounded bg-gray-100 text-gray-500 text-xs px-2 py-0.5">
            ללא תחום
          </span>
        )}
        <div className="flex items-center gap-2 ms-auto">
          <button
            onClick={toggleShluchim}
            className="text-sm text-status-magenta hover:underline"
          >
            {open ? "הסתר שלוחים" : "שלוחים"}
          </button>
          {isAdmin && (
            <>
              <Link
                href={`/dashboard/areas/${area.id}/edit`}
                className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
              >
                ערוך
              </Link>
              <button
                onClick={remove}
                className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
              >
                מחק
              </button>
            </>
          )}
        </div>
      </div>
      {area.area_notes && <p className="text-sm text-gray-600">{area.area_notes}</p>}

      {open && (
        <div className="border-t border-gray-100 pt-2">
          {shluchim === null ? (
            <p className="text-sm text-gray-400">טוען…</p>
          ) : shluchim.length === 0 ? (
            <p className="text-sm text-gray-400">אין שלוחים המכסים אזור זה.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {shluchim.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/contacts/${c.id}`}
                    className="rounded-full bg-status-magenta/10 text-status-magenta px-3 py-1 text-sm hover:bg-status-magenta/20"
                  >
                    {contactFullName(c)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
