"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import type { Area } from "@/lib/types";

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

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("areas", "אזורים")}</h1>
        {isAdmin && (
          <Link
            href="/dashboard/areas/add"
            className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
          >
            {t("page.add_area", "אזור חדש")}
          </Link>
        )}
      </div>
      <p className="text-sm text-gray-500">{t("page.areas_intro")}</p>

      <div className="space-y-3">
        {areas.map((a) => (
          <AreaCard key={a.id} area={a} isAdmin={isAdmin} onChanged={reload} />
        ))}
        {areas.length === 0 && (
          <p className="bg-white rounded-xl shadow-sm px-4 py-6 text-center text-gray-400">
            {t("page.no_areas", "אין אזורים עדיין.")}
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
  const { t } = useLocalization();

  async function remove() {
    if (!confirm(`${t("msg.delete_area_confirm", "למחוק את האזור?")} '${area.area_name}'`))
      return;
    await apiFetch(`/api/areas/${area.id}`, { method: "DELETE" });
    await onChanged();
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* The area name links to its detail page (works even if maps are down). */}
        <Link
          href={`/dashboard/areas/${area.id}`}
          className="font-medium text-status-magenta hover:underline"
        >
          {area.area_name}
        </Link>
        {area.area_polygon ? (
          <span className="rounded bg-status-green/10 text-status-green text-xs px-2 py-0.5">
            {t("page.area_has_boundary", "תחום מוגדר")}
          </span>
        ) : (
          <span className="rounded bg-gray-100 text-gray-500 text-xs px-2 py-0.5">
            {t("page.area_no_boundary", "ללא תחום")}
          </span>
        )}
        <div className="flex items-center gap-2 ms-auto">
          <Link
            href={`/dashboard/areas/${area.id}`}
            className="text-sm text-status-magenta hover:underline"
          >
            {t("page.show_area", "הצג אזור »")}
          </Link>
          {isAdmin && (
            <>
              <Link
                href={`/dashboard/areas/${area.id}/edit`}
                className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
              >
                {t("action.edit", "ערוך")}
              </Link>
              <button
                onClick={remove}
                className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
              >
                {t("action.delete", "מחק")}
              </button>
            </>
          )}
        </div>
      </div>
      {area.area_notes && <p className="text-sm text-gray-600">{area.area_notes}</p>}
    </div>
  );
}
