"use client";

import { useEffect, useMemo, useState } from "react";

import {
  listLocalization,
  updateLocalization,
  type LocalizationRow,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { Input } from "@/components/ui/input";

/** fixes95: the translations page is split by SCREEN (tabs), by each key's
 *  prefix — the part before the first dot ("users.login_status" → users).
 *  Unknown prefixes fall into "כללי". Order = tab order. */
const PAGE_GROUPS: { id: string; he: string; prefixes: string[] }[] = [
  { id: "contacts", he: "אנשי קשר", prefixes: ["contacts", "contact", "contact_mekurav", "contact_shliach", "sd", "significant_dates"] },
  { id: "users", he: "משתמשים", prefixes: ["users", "shliach"] },
  { id: "visits", he: "ביקורים", prefixes: ["visits", "visit", "visitsummary"] },
  { id: "apartments", he: "דירות", prefixes: ["apt", "apartments", "apartment", "bulkedit"] },
  { id: "buildings", he: "בניינים", prefixes: ["buildings", "building", "floors"] },
  { id: "areas", he: "אזורים", prefixes: ["areas", "admin_areas", "apm", "geo", "map"] },
  { id: "tasks", he: "משימות וקמפיינים", prefixes: ["task", "task_pdf", "campaign", "claim", "paper", "batch", "report_number"] },
  { id: "activist", he: "מסך הפעיל", prefixes: ["street", "street_view", "route", "activist_route", "activist_home", "shliach_msg", "messages_from_activists"] },
  { id: "reports", he: "דוחות", prefixes: ["reports", "report"] },
  { id: "donations", he: "תרומות", prefixes: ["donation"] },
  { id: "dashboard", he: "לוח בקרה וחיפוש", prefixes: ["dashboard", "search", "ai", "ai_query"] },
  { id: "fields", he: "רשימות ושדות", prefixes: ["pl", "picklist", "picklist_def", "cf", "field", "fields", "columns", "column", "select"] },
  { id: "settings", he: "הגדרות", prefixes: ["settings", "shliach_config", "public_settings", "logo", "gallery", "image_picker", "backup", "localization", "lang", "loc"] },
  { id: "auth", he: "כניסה והרשמה", prefixes: ["auth", "signup", "verify", "public"] },
  { id: "admin", he: "מנהל מערכת", prefixes: ["admin", "logs"] },
  { id: "errors", he: "הודעות שגיאה", prefixes: ["error", "msg", "validation", "confirm"] },
  { id: "menu", he: "תפריט", prefixes: ["nav", "header"] },
  { id: "general", he: "כללי", prefixes: [] },
];
const GROUP_BY_PREFIX = new Map(
  PAGE_GROUPS.flatMap((g) => g.prefixes.map((pfx) => [pfx, g.id] as const)),
);
const groupOf = (row: LocalizationRow) =>
  GROUP_BY_PREFIX.get(row.technical_name.split(".")[0]) ?? "general";

export default function LocalizationPage() {
  const { isAdmin, loading, user } = useAuth();
  // fixes93: off unless the superadmin enabled this page for the org.
  const pageEnabled = user?.organization?.feature_flags?.localization_page_enabled === true;
  const { t } = useLocalization();
  const [rows, setRows] = useState<LocalizationRow[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (loading || !isAdmin || !pageEnabled) return;
    listLocalization().then(setRows).catch(() => {});
  }, [loading, isAdmin, pageEnabled]);

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

  // fixes95: rows grouped by screen (PAGE_GROUPS), keys sorted inside.
  const groups = useMemo(() => {
    const m = new Map<string, LocalizationRow[]>();
    for (const r of filtered) {
      const g = groupOf(r);
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(r);
    }
    return PAGE_GROUPS.filter((g) => m.has(g.id)).map(
      (g) =>
        [g, m.get(g.id)!.sort((a, b) => a.technical_name.localeCompare(b.technical_name))] as const,
    );
  }, [filtered]);
  // "all" = every group with a divider; otherwise the one tab.
  const [tab, setTab] = useState<string>("all");
  const visibleGroups = tab === "all" ? groups : groups.filter(([g]) => g.id === tab);
  const tabCount = (id: string) =>
    id === "all" ? filtered.length : (groups.find(([g]) => g.id === id)?.[1].length ?? 0);

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!pageEnabled) {
    return (
      <p className="text-muted-foreground">
        {t("localization.page_disabled", "עמוד התרגומים אינו פעיל בארגון זה. ניתן להפעיל אותו דרך מנהל המערכת.")}
      </p>
    );
  }
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
        <p className="mt-1 text-sm text-muted-foreground">
          {t("page.localization_intro", "ערוך את טקסטי הממשק בעברית ובאנגלית.")}
        </p>
      </div>

      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("loc.search", "חיפוש לפי טקסט או מפתח…")}
        className="max-w-sm"
      />

      {/* fixes95: one tab per screen (+ "הכל"); counts follow the search. */}
      <div role="tablist" className="flex flex-wrap gap-2">
        {[{ id: "all", he: "הכל" }, ...PAGE_GROUPS].map((g) => {
          const n = tabCount(g.id);
          if (g.id !== "all" && n === 0) return null;
          const active = tab === g.id;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(g.id)}
              className={`min-h-[36px] rounded-full border px-3 text-sm transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              {t(`loc.group.${g.id}`, g.he)}{" "}
              <span className={active ? "opacity-80" : "text-muted-foreground"}>({n})</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-6">
        {visibleGroups.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("loc.no_results", "לא נמצאו טקסטים.")}</p>
        )}
        {visibleGroups.map(([group, entityRows]) => (
          <section key={group.id}>
            <h2 className="mb-2 flex items-center gap-2 border-b border-border pb-1 text-base font-semibold">
              {t(`loc.group.${group.id}`, group.he)}
              <span className="text-sm font-normal text-muted-foreground">({entityRows.length})</span>
            </h2>
            <div className="bg-card rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-background text-muted-foreground text-xs">
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
      <p className="text-xs text-muted-foreground">
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
    "w-full rounded-md border border-input px-2 py-1 focus:border-primary focus:outline-none";

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2 align-top">
        <code className="text-xs text-muted-foreground" dir="ltr">
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
            className="rounded-md bg-primary text-white px-3 py-1 text-xs hover:opacity-90 disabled:opacity-30"
          >
            {t("action.save", "שמור")}
          </button>
        )}
      </td>
    </tr>
  );
}
