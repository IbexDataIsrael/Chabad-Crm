"use client";

import { useEffect, useMemo, useState } from "react";

import {
  listLocalization,
  updateLocalization,
  type LocalizationRow,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

// Friendly section headings per entity_type — fallback values for the
// t(`loc.entity.${entity}`, ...) calls below. Unknown types fall back to the raw key.
const ENTITY_LABELS: Record<string, string> = {
  error: "הודעות שגיאה",
  msg: "הודעות מערכת",
  table: "טבלאות",
  column: "שדות",
  page: "דפים",
  nav: "ניווט",
  action: "פעולות",
  auth: "התחברות",
  field: "ניהול שדות",
  filter: "סינון",
  apt: "דירות",
  apm: "מפת אזורים",
  shliach: "פעיל",
  verify: "אימות",
  signup: "הרשמה",
  interaction_category: "קטגוריות אינטראקציה",
};

// Sections most useful to edit first.
const ENTITY_ORDER = ["error", "msg", "page", "action", "auth"];

export default function LocalizationPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [rows, setRows] = useState<LocalizationRow[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (loading || !isAdmin) return;
    listLocalization().then(setRows).catch(() => {});
  }, [loading, isAdmin]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.technical_name.toLowerCase().includes(q) ||
        r.hebrew_label.toLowerCase().includes(q) ||
        (r.english_label ?? "").toLowerCase().includes(q),
    );
  }, [rows, filter]);

  // Group rows into sections by entity_type, ordered with the most-edited first.
  const groups = useMemo(() => {
    const m = new Map<string, LocalizationRow[]>();
    for (const r of filtered) {
      if (!m.has(r.entity_type)) m.set(r.entity_type, []);
      m.get(r.entity_type)!.push(r);
    }
    return Array.from(m.entries()).sort(([a], [b]) => {
      const ia = ENTITY_ORDER.indexOf(a);
      const ib = ENTITY_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b);
    });
  }, [filtered]);

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("page.localization_title", "תרגומים")}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t("page.localization_intro", "ערוך את טקסטי הממשק בעברית ובאנגלית.")}
        </p>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="🔍"
        className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm"
      />

      <div className="space-y-6">
        {groups.map(([entity, entityRows]) => (
          <section key={entity}>
            <h2 className="text-sm font-semibold mb-2">
              {t(`loc.entity.${entity}`, ENTITY_LABELS[entity] ?? entity)}{" "}
              <span className="text-gray-400 font-normal">({entityRows.length})</span>
            </h2>
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-start px-3 py-2 font-medium">key</th>
                    <th className="text-start px-3 py-2 font-medium">
                      {t("common.hebrew_label", "עברית")}
                    </th>
                    <th className="text-start px-3 py-2 font-medium">English</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {entityRows.map((row) => (
                    <LocalizationRowEditor
                      key={row.id}
                      row={row}
                      onSaved={(updated) =>
                        setRows((prev) =>
                          prev.map((r) => (r.id === updated.id ? updated : r)),
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      <p className="text-xs text-gray-400">
        {t(
          "page.localization_reload_hint",
          "שינויים ייכנסו לתוקף בכל המערכת לאחר רענון הדף.",
        )}
      </p>
    </div>
  );
}

function LocalizationRowEditor({
  row,
  onSaved,
}: {
  row: LocalizationRow;
  onSaved: (r: LocalizationRow) => void;
}) {
  const { t } = useLocalization();
  const [he, setHe] = useState(row.hebrew_label);
  const [en, setEn] = useState(row.english_label ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = he !== row.hebrew_label || en !== (row.english_label ?? "");

  async function save() {
    setBusy(true);
    try {
      const updated = await updateLocalization(row.id, {
        hebrew_label: he,
        english_label: en || null,
      });
      onSaved(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setBusy(false);
    }
  }

  const cell =
    "w-full rounded-md border border-gray-300 px-2 py-1 focus:border-status-magenta focus:outline-none";

  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-2 align-top">
        <code className="text-xs text-gray-500" dir="ltr">
          {row.technical_name}
        </code>
      </td>
      <td className="px-3 py-2">
        <input dir="rtl" className={cell} value={he} onChange={(e) => setHe(e.target.value)} />
      </td>
      <td className="px-3 py-2">
        <input dir="ltr" className={cell} value={en} onChange={(e) => setEn(e.target.value)} />
      </td>
      <td className="px-3 py-2 text-end whitespace-nowrap">
        {saved ? (
          <span className="text-status-green text-xs">{t("action.saved", "נשמר ✓")}</span>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={!dirty || busy}
            className="rounded-md bg-status-magenta text-white px-3 py-1 text-xs hover:opacity-90 disabled:opacity-30"
          >
            {t("action.save", "שמור")}
          </button>
        )}
      </td>
    </tr>
  );
}
