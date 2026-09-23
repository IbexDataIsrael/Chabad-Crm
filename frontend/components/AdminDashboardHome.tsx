"use client";

import Link from "next/link";
import {
  Activity,
  Building2,
  Home as HomeIcon,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { NewSignupsCard } from "@/components/NewSignupsCard";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { COLOR_HEX } from "@/lib/colors";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { usePicklist } from "@/lib/picklists";
import type { DashboardSummary } from "@/lib/types";

// The 5 CLAUDE.md status markers, mapped to this field's technical values
// (see backend/app/core/jewish_status.py) — these are mandated brand colors,
// not chosen for chart contrast, so every use below pairs them with a text
// label (never color alone), per the dataviz relief rule.
const JEWISH_STATUS_COLOR: Record<string, string> = {
  jewish: COLOR_HEX.green,
  jewish_interested: COLOR_HEX.magenta,
  jewish_gentile: COLOR_HEX.yellow,
  jewish_interested_gentile: COLOR_HEX.orange,
  jewish_shtumtz: COLOR_HEX.darkred,
};
const NEUTRAL_GRAY = "#9ca3af";

const RANGE_OPTIONS = [7, 30, 90] as const;

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatTile({
  label,
  value,
  previousValue,
  icon: Icon,
  rangeLabel,
}: {
  label: string;
  value: number;
  previousValue: number;
  icon: LucideIcon;
  rangeLabel: string;
}) {
  const delta = value - previousValue;
  const up = delta > 0;
  const flat = delta === 0;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold text-foreground">{formatCompact(value)}</p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1 text-xs">
        {!flat && (
          <span
            className={`flex items-center gap-0.5 font-medium ${up ? "text-success" : "text-muted-foreground"}`}
          >
            {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {up ? "+" : ""}
            {delta}
          </span>
        )}
        <span className="text-muted-foreground">{rangeLabel}</span>
      </div>
    </Card>
  );
}

/** A horizontal bar row — used for both the top-activists and Jewish-status
 * breakdown lists. Always carries a visible text label + numeric value next
 * to the bar (never color-only identity), per the dataviz relief rule. */
function BarRow({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.max((count / max) * 100, 4) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-sm text-foreground" title={label}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-8 shrink-0 text-end text-sm font-medium text-foreground">{count}</span>
    </div>
  );
}

export function AdminDashboardHome() {
  const { t, lang } = useLocalization();
  const [days, setDays] = usePersistentState<number>("crm.dashboard.days", 30);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const jewishStatus = usePicklist("apartment.Jewish_status");

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<DashboardSummary>(`/api/dashboard/summary?days=${days}`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [days]);

  const trendData = useMemo(
    () =>
      (data?.trend ?? []).map((p) => ({
        ...p,
        dateLabel: new Date(p.date).toLocaleDateString(lang === "he" ? "he-IL" : "en-US", {
          month: "short",
          day: "numeric",
        }),
      })),
    [data?.trend, lang],
  );

  const maxActivistEdits = Math.max(1, ...(data?.top_activists.map((a) => a.edits) ?? [1]));
  const maxBreakdown = Math.max(1, ...(data?.jewish_status_breakdown.map((b) => b.count) ?? [1]));

  const rangeLabel = t("dashboard.stat.vs_previous", "לעומת התקופה הקודמת");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("dashboard.title", "לוח בקרה")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("dashboard.subtitle", "סקירה כללית של הפעילות במערכת")}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setDays(opt)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                days === opt ? "bg-card text-foreground shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("dashboard.range_label", "ב-{n} הימים האחרונים").replace("{n}", String(opt))}
            </button>
          ))}
        </div>
      </div>

      <NewSignupsCard />

      {loading && !data ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        </div>
      ) : !data ? (
        <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t("dashboard.stat.new_contacts", "אנשי קשר חדשים")}
              value={data.new_contacts.value}
              previousValue={data.new_contacts.previous_value}
              icon={Users}
              rangeLabel={rangeLabel}
            />
            <StatTile
              label={t("dashboard.stat.new_apartments", "דירות חדשות")}
              value={data.new_apartments.value}
              previousValue={data.new_apartments.previous_value}
              icon={HomeIcon}
              rangeLabel={rangeLabel}
            />
            <StatTile
              label={t("dashboard.stat.activist_activity", "פעילות פעילים")}
              value={data.activist_edits.value}
              previousValue={data.activist_edits.previous_value}
              icon={Activity}
              rangeLabel={rangeLabel}
            />
            <StatTile
              label={t("dashboard.stat.jewish_changes", "שינויים בסטטוס יהדות")}
              value={data.jewish_status_changes.value}
              previousValue={data.jewish_status_changes.previous_value}
              icon={Building2}
              rangeLabel={rangeLabel}
            />
          </div>

          {/* Growth chart + top activists */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h2 className="text-sm font-semibold text-foreground">
                {t("dashboard.chart.growth_title", "גידול באנשי קשר ודירות")}
              </h2>
              <div className="mt-4 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="dateLabel"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Legend
                      formatter={(value) =>
                        value === "contacts"
                          ? t("dashboard.stat.new_contacts", "אנשי קשר חדשים")
                          : t("dashboard.stat.new_apartments", "דירות חדשות")
                      }
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="contacts"
                      stroke={COLOR_HEX.magenta}
                      strokeWidth={2}
                      dot={{ r: 3, fill: COLOR_HEX.magenta, stroke: "hsl(var(--card))", strokeWidth: 2 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="apartments"
                      stroke={COLOR_HEX.green}
                      strokeWidth={2}
                      dot={{ r: 3, fill: COLOR_HEX.green, stroke: "hsl(var(--card))", strokeWidth: 2 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground">
                {t("dashboard.chart.top_activists_title", "פעילים מובילים")}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("dashboard.chart.top_activists_subtitle", "עדכוני דירות לפי פעיל")}
              </p>
              <div className="mt-4 space-y-3">
                {data.top_activists.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("dashboard.no_activity", "אין פעילות פעילים בטווח התאריכים הזה.")}
                  </p>
                ) : (
                  data.top_activists.map((a) => (
                    <BarRow
                      key={a.user_id}
                      label={a.name}
                      count={a.edits}
                      max={maxActivistEdits}
                      color={COLOR_HEX.magenta}
                    />
                  ))
                )}
              </div>
            </Card>
          </div>

          {/* Jewish-status breakdown + recent changes */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground">
                {t("dashboard.chart.jewish_breakdown_title", "התפלגות שינויי סטטוס יהדות")}
              </h2>
              <div className="mt-4 space-y-3">
                {data.jewish_status_breakdown.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("dashboard.recent_changes_empty", "אין שינויים בטווח התאריכים הזה.")}
                  </p>
                ) : (
                  data.jewish_status_breakdown.map((b) => (
                    <BarRow
                      key={b.value ?? "na"}
                      label={b.value ? jewishStatus.labelFor(b.value) : t("common.none", "ללא")}
                      count={b.count}
                      max={maxBreakdown}
                      color={b.value ? JEWISH_STATUS_COLOR[b.value] ?? NEUTRAL_GRAY : NEUTRAL_GRAY}
                    />
                  ))
                )}
              </div>
            </Card>

            <Card className="p-5 lg:col-span-2">
              <h2 className="text-sm font-semibold text-foreground">
                {t("dashboard.recent_changes_title", "שינויים אחרונים בסטטוס יהדות")}
              </h2>
              <div className="mt-4 space-y-1">
                {data.recent_jewish_changes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("dashboard.recent_changes_empty", "אין שינויים בטווח התאריכים הזה.")}
                  </p>
                ) : (
                  data.recent_jewish_changes.map((c) => (
                    <div
                      key={`${c.apartment_id}-${c.changed_at}`}
                      className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-sm last:border-0"
                    >
                      {/* fixes57 §3: link straight to the apartment instead of
                          plain text — every row already carries apartment_id. */}
                      <Link
                        href={`/dashboard/apartments/${c.apartment_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.label}
                      </Link>
                      {c.building_address && (
                        <span className="text-muted-foreground">· {c.building_address}</span>
                      )}
                      <span className="ms-auto flex items-center gap-1.5">
                        <Badge variant="outline" className="text-xs">
                          {c.old_value ? jewishStatus.labelFor(c.old_value) : t("common.none", "ללא")}
                        </Badge>
                        <span className="text-muted-foreground">→</span>
                        <Badge
                          className="text-xs text-white"
                          style={{
                            backgroundColor: c.new_value
                              ? JEWISH_STATUS_COLOR[c.new_value] ?? NEUTRAL_GRAY
                              : NEUTRAL_GRAY,
                          }}
                        >
                          {c.new_value ? jewishStatus.labelFor(c.new_value) : t("common.none", "ללא")}
                        </Badge>
                      </span>
                      <span className="w-full text-xs text-muted-foreground sm:w-auto">
                        {c.editor_name &&
                          t("dashboard.changed_by", 'שונה ע"י {name}').replace("{name}", c.editor_name)}
                        {c.editor_name && " · "}
                        {new Date(c.changed_at).toLocaleDateString(lang === "he" ? "he-IL" : "en-US")}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
