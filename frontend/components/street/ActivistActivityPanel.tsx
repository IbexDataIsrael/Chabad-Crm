"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import type { StreetActivity } from "@/lib/types";

function formatTime(value: string | null, lang: string): string {
  if (!value) return "—";
  // The API returns naive UTC.
  const d = new Date(value.endsWith("Z") || value.includes("+") ? value : `${value}Z`);
  return d.toLocaleString(lang === "en" ? "en-GB" : "he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** fixes74 §12: the admin's header over an activist's street2 view — who,
 *  when their app last synced, their progress and a timestamped log of
 *  mark / unmark / building-complete events. Read-only; not a GPS tracker. */
export function ActivistActivityPanel({
  activity,
  doorsDone,
  doorsToKnock,
  buildingsDone,
  buildingsTotal,
}: {
  activity: StreetActivity | null;
  doorsDone: number;
  doorsToKnock: number;
  buildingsDone: number;
  buildingsTotal: number;
}) {
  const { t, lang } = useLocalization();
  const eventLabel: Record<string, string> = {
    mark: t("street_view.event_mark", "דלת סומנה כבוצעה"),
    unmark: t("street_view.event_unmark", "סימון דלת בוטל"),
    building_complete: t("street_view.event_building_complete", "בניין הושלם"),
  };
  const pct = doorsToKnock > 0 ? Math.round((doorsDone / doorsToKnock) * 100) : 0;

  return (
    <section className="mb-4 space-y-3 rounded-xl bg-white/95 p-4 text-slate-900 shadow">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">
          {t("street_view.title", "תצוגת הפעיל: {name}").replace("{name}", activity?.full_name ?? "…")}
        </h2>
        <Link href="/dashboard/street2" className="text-sm text-sky-700 hover:underline">
          {t("street_view.pick_other", "בחירת פעיל אחר")}
        </Link>
      </div>
      <p className="text-sm">
        <span className="font-semibold">{t("street_view.last_sync", "סנכרון אחרון")}:</span>{" "}
        {activity?.last_sync_at
          ? formatTime(activity.last_sync_at, lang)
          : t("street_view.never_synced", "האפליקציה של הפעיל עוד לא סונכרנה")}
      </p>
      <p className="text-xs text-slate-500">
        {t(
          "street_view.hint",
          "צפייה בלבד. הנתונים מתעדכנים כשהאפליקציה של הפעיל מסתנכרנת — זה לא מעקב מיקום חי.",
        )}
      </p>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-slate-100 p-2">
          <div className="text-xs text-slate-500">{t("street_view.doors", "דלתות שבוצעו")}</div>
          <div className="font-bold tabular-nums">
            {doorsDone} / {doorsToKnock} ({pct}%)
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-200">
            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="rounded-lg bg-slate-100 p-2">
          <div className="text-xs text-slate-500">{t("street_view.buildings", "בניינים שהושלמו")}</div>
          <div className="font-bold tabular-nums">
            {buildingsDone} / {buildingsTotal}
          </div>
        </div>
      </div>
      <details open className="text-sm">
        <summary className="cursor-pointer font-semibold">
          {t("street_view.log", "יומן פעילות")} ({activity?.events.length ?? 0})
        </summary>
        {activity && activity.events.length > 0 ? (
          <ol className="mt-2 max-h-64 divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200">
            {activity.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-2 py-1.5">
                <span className="tabular-nums text-xs text-slate-500" dir="ltr">
                  {formatTime(e.occurred_at, lang)}
                </span>
                <span className="font-medium">{eventLabel[e.event_type] ?? e.event_type}</span>
                <span className="text-slate-600">{e.label || e.building_label || ""}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-slate-500">{t("street_view.no_events", "אין עדיין אירועים ביומן.")}</p>
        )}
      </details>
    </section>
  );
}

interface ActivistOption {
  id: number;
  full_name: string;
  role: string;
  is_active: boolean;
}

/** Admin landing on /dashboard/street2 without ?activist= — pick whose view
 *  to open (it used to just bounce to the Apartments grid). */
export function ActivistPicker() {
  const { t } = useLocalization();
  const [activists, setActivists] = useState<ActivistOption[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiFetch<ActivistOption[]>("/api/users")
      .then((rows) => setActivists(rows.filter((u) => u.role === "shliach" && u.is_active)))
      .catch(() => setActivists([]));
  }, []);

  const shown = (activists ?? []).filter((a) => a.full_name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <section className="mx-auto max-w-lg space-y-3 rounded-xl bg-white/95 p-4 text-slate-900 shadow">
      <h1 className="text-lg font-bold">{t("street_view.pick_title", "צפייה בתצוגת פעיל")}</h1>
      <p className="text-sm text-slate-600">
        {t(
          "street_view.pick_hint",
          "בחרו פעיל כדי לראות את המסלול שלו כפי שהוא רואה אותו — ההתקדמות ויומן הפעילות שלו.",
        )}
      </p>
      <input
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        placeholder={t("action.search", "חיפוש…")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {activists === null ? (
        <p className="text-sm text-slate-500">{t("action.loading", "טוען…")}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500">{t("street_view.no_activists", "אין פעילים להצגה.")}</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200">
          {shown.map((a) => (
            <li key={a.id}>
              <Link
                href={`/dashboard/street2?activist=${a.id}`}
                className="block px-3 py-2 text-sm hover:bg-slate-100"
              >
                {a.full_name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
