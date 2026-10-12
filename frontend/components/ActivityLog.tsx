"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** fixes102: the per-org activity log — superadmin only. Rows exist only for
 *  orgs whose activity-log toggle is on (Organizations → org settings). */

const PAGE_SIZE = 50;

interface ActivityRow {
  id: number;
  created_at: string | null;
  organization_id: number;
  organization_name: string | null;
  user_id: number | null;
  user_name: string | null;
  kind: "action" | "page_view";
  action: string;
  method: string | null;
  route: string | null;
  entity_id: number | null;
  page: string | null;
  ip_address: string | null;
}

interface Options {
  users: { id: number; name: string }[];
  actions: string[];
}

type Kind = "" | "action" | "page_view";

function localTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("he-IL");
}

/** "apartments.update" → «דירות · עודכן»; unknown parts fall back to the raw name. */
function useActivityLabel() {
  const { t } = useLocalization();
  return (action: string): string => {
    if (action === "page_view") return t("activity.page_view", "צפייה בעמוד");
    const dot = action.lastIndexOf(".");
    if (dot < 0) return action;
    const resource = action.slice(0, dot);
    const verb = action.slice(dot + 1);
    return `${t(`activity.res.${resource}`, resource)} · ${t(`activity.verb.${verb}`, verb)}`;
  };
}

export function ActivityLog({ orgId }: { orgId: string }) {
  const { t } = useLocalization();
  const label = useActivityLabel();
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<Kind>("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: ActivityRow[] } | null>(null);
  const [options, setOptions] = useState<Options>({ users: [], actions: [] });

  useEffect(() => {
    setPage(1);
    setUserId("");
    setAction("");
    const q = orgId ? `?organization_id=${orgId}` : "";
    apiFetch<Options>(`/api/logs/activity/options${q}`)
      .then(setOptions)
      .catch(() => setOptions({ users: [], actions: [] }));
  }, [orgId]);

  useEffect(() => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (orgId) params.set("organization_id", orgId);
    if (userId) params.set("user_id", userId);
    if (kind) params.set("kind", kind);
    if (action) params.set("action", action);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    apiFetch<{ total: number; items: ActivityRow[] }>(`/api/logs/activity?${params}`)
      .then(setData)
      .catch(() => setData({ total: 0, items: [] }));
  }, [orgId, userId, kind, action, dateFrom, dateTo, page]);

  const selectClass = "h-10 rounded-md border border-input bg-background px-2 text-sm";
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <Card className="p-4 space-y-3">
      <p className="text-xs text-muted-foreground">
        {t(
          "activity.intro",
          "פעולות ועמודים שנפתחו, בארגונים שבהם הופעל יומן הפעילות. נשמר 90 יום.",
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={selectClass}
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            setPage(1);
          }}
          aria-label={t("logs.col_user", "משתמש")}
        >
          <option value="">{t("activity.all_users", "כל המשתמשים")}</option>
          {options.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as Kind);
            setPage(1);
          }}
          aria-label={t("activity.col_kind", "סוג")}
        >
          <option value="">{t("activity.all_kinds", "פעולות וצפיות")}</option>
          <option value="action">{t("activity.kind_action", "פעולות בלבד")}</option>
          <option value="page_view">{t("activity.kind_page_view", "צפיות בעמודים בלבד")}</option>
        </select>
        <select
          className={selectClass}
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          aria-label={t("activity.col_action", "פעולה")}
        >
          <option value="">{t("activity.all_actions", "כל הפעולות")}</option>
          {options.actions.map((a) => (
            <option key={a} value={a}>
              {label(a)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          {t("activity.date_from", "מתאריך")}
          <Input
            type="date"
            className="h-10 w-auto"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="flex items-center gap-1 text-sm">
          {t("activity.date_to", "עד תאריך")}
          <Input
            type="date"
            className="h-10 w-auto"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      {data === null ? (
        <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("logs.empty", "אין רשומות.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pe-3 text-start font-medium">{t("logs.col_time", "זמן")}</th>
                <th className="py-2 pe-3 text-start font-medium">{t("logs.col_org", "ארגון")}</th>
                <th className="py-2 pe-3 text-start font-medium">{t("logs.col_user", "משתמש")}</th>
                <th className="py-2 pe-3 text-start font-medium">{t("activity.col_action", "פעולה")}</th>
                <th className="py-2 pe-3 text-start font-medium">{t("activity.col_target", "יעד")}</th>
                <th className="py-2 text-start font-medium">{t("logs.col_ip", "כתובת IP")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 even:bg-muted/40">
                  <td className="py-2 pe-3 whitespace-nowrap">{localTime(r.created_at)}</td>
                  <td className="py-2 pe-3 whitespace-nowrap">
                    #{r.organization_id} {r.organization_name ?? ""}
                  </td>
                  <td className="py-2 pe-3">{r.user_name ?? "—"}</td>
                  <td className="py-2 pe-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        r.kind === "page_view" ? "bg-muted text-foreground" : "bg-primary/10 text-primary"
                      }`}
                    >
                      {label(r.action)}
                    </span>
                  </td>
                  <td className="py-2 pe-3 text-muted-foreground" dir="ltr" style={{ unicodeBidi: "isolate" }}>
                    {r.kind === "page_view"
                      ? r.page
                      : r.entity_id != null
                        ? `#${r.entity_id}`
                        : r.route ?? "—"}
                  </td>
                  <td className="py-2" dir="ltr">
                    {r.ip_address ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {t("logs.total", "סה״כ: {n}").replace("{n}", String(data.total))}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t("pager.prev", "→ הקודם")}
            </Button>
            <span dir="ltr">
              {page} / {pages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t("pager.next", "הבא ←")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
