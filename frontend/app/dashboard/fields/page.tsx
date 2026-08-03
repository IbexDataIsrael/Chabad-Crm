"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFieldSettings, type FieldSetting } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";

// fixes40 round 2 §3.1: 3 tabs, matching dashboard/custom-fields and
// dashboard/picklists. "Apartment" also carries the building entity (its
// own built-in toggleable fields never got a separate tab elsewhere either).
type FieldsTab = "contacts" | "apartment" | "visit";

const TAB_ENTITIES: Record<FieldsTab, string[]> = {
  contacts: ["contact", "contact_mekurav", "contact_shliach"],
  apartment: ["building", "apartment"],
  visit: ["visit"],
};

const TABS: { key: FieldsTab; icon: string; labelKey: string; fallback: string }[] = [
  { key: "contacts", icon: "👤", labelKey: "pl.tab_contacts", fallback: "אנשי קשר" },
  { key: "apartment", icon: "🏠", labelKey: "pl.tab_apartment", fallback: "דירה" },
  { key: "visit", icon: "📋", labelKey: "pl.tab_visit", fallback: "ביקורים" },
];

const ENTITY_LABELS: Record<string, { labelKey: string; fallback: string }> = {
  contact: { labelKey: "contacts", fallback: "אנשי קשר" },
  contact_mekurav: { labelKey: "contact_mekurav", fallback: "מקורב" },
  contact_shliach: { labelKey: "contact_shliach", fallback: "פעיל" },
  building: { labelKey: "building", fallback: "בניין" },
  apartment: { labelKey: "apartment", fallback: "דירה" },
  visit: { labelKey: "page.visits", fallback: "ביקורים" },
};

export default function FieldsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { t } = useLocalization();
  const { settings, refresh } = useFieldSettings();
  const { success, error } = useToast();
  const [tab, setTab] = usePersistentState<FieldsTab>("crm.fields.tab", "contacts");

  async function toggle(field_key: string, is_visible: boolean) {
    try {
      await apiFetch("/api/field-settings", {
        method: "PUT",
        body: JSON.stringify({ field_key, is_visible }),
      });
      await refresh();
      success(is_visible ? t("msg.shown", "השדה הוצג") : t("msg.hidden", "השדה הוסתר"));
    } catch (err) {
      error(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  async function setOrder(field_key: string, is_visible: boolean, sort_order: number | null) {
    try {
      await apiFetch("/api/field-settings", {
        method: "PUT",
        body: JSON.stringify({ field_key, is_visible, sort_order }),
      });
      await refresh();
    } catch (err) {
      error(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  if (authLoading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  const entities = TAB_ENTITIES[tab];
  const tabFields = settings.filter((s) => entities.includes(s.entity));
  // fixes40 round 2 §3.4: order numbers are unique within the whole *tab*
  // (section) — a mekurav field and a shliach field share the Contact
  // section's numbering space, so duplicates are computed across the tab,
  // not per underlying entity_type.
  const duplicateOrders = new Set<number>();
  const seenOrders = new Set<number>();
  for (const f of tabFields) {
    if (f.sort_order == null) continue;
    if (seenOrders.has(f.sort_order)) duplicateOrders.add(f.sort_order);
    seenOrders.add(f.sort_order);
  }

  function renderRows(group: FieldSetting[]) {
    return (
      <ul className="divide-y divide-gray-100">
        {group.map((f) => (
          <FieldRow
            key={f.field_key}
            field={f}
            duplicate={f.sort_order != null && duplicateOrders.has(f.sort_order)}
            onToggle={toggle}
            onOrderChange={setOrder}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">{t("page.fields_title", "ניהול שדות")}</h1>
        <p className="text-sm text-gray-500">
          {t(
            "page.fields_intro",
            "בחר אילו שדות יופיעו בכרטיס איש הקשר, בטופס וברשימה. שדות שיוסתרו לא יוצגו בשום מקום במערכת.",
          )}
        </p>
      </div>

      {/* fixes40 round 2 §3.1: tab bar — identical pattern to dashboard/picklists. */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === tb.key
                ? "border-status-magenta text-status-magenta"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <span aria-hidden>{tb.icon}</span>
            {t(tb.labelKey, tb.fallback)}
          </button>
        ))}
      </div>

      <section className="bg-white rounded-xl shadow-sm">
        <div className="px-4 py-1.5 flex items-center justify-end border-b border-gray-100 text-[11px] font-medium text-gray-400">
          {t("fields.order_header", "סדר תצוגה")}
        </div>
        {entities.length > 1
          ? entities.map((entity) => {
              const group = tabFields.filter((f) => f.entity === entity);
              if (group.length === 0) return null;
              const meta = ENTITY_LABELS[entity];
              return (
                <div key={entity}>
                  <h2 className="px-4 py-2 bg-gray-50 text-xs font-medium text-gray-500 border-b border-gray-100">
                    {t(meta.labelKey, meta.fallback)}
                  </h2>
                  {renderRows(group)}
                </div>
              );
            })
          : renderRows(tabFields)}
        {tabFields.length === 0 && (
          <p className="px-4 py-6 text-center text-gray-400">
            {t("cf.none", "אין שדות עדיין.")}
          </p>
        )}
      </section>
    </div>
  );
}

function FieldRow({
  field,
  duplicate,
  onToggle,
  onOrderChange,
}: {
  field: FieldSetting;
  duplicate: boolean;
  onToggle: (key: string, visible: boolean) => Promise<void>;
  onOrderChange: (key: string, visible: boolean, order: number | null) => Promise<void>;
}) {
  const { t, lang } = useLocalization();
  const [orderDraft, setOrderDraft] = useState(field.sort_order?.toString() ?? "");

  // Keep the draft in sync when another tab/refresh changes the saved value
  // out from under an untouched input.
  useEffect(() => {
    setOrderDraft(field.sort_order?.toString() ?? "");
  }, [field.sort_order]);

  // fixes33 §5.1: a dynamic custom-picklist row carries its own bilingual
  // name directly (no field_localization row exists for per-org custom text)
  // — everything else resolves through the usual localization table.
  const label =
    field.label != null
      ? (lang === "en" ? field.english_label || field.label : field.label)
      : t(field.label_key, field.field_key);

  function commitOrder() {
    const trimmed = orderDraft.trim();
    if (trimmed === "") {
      if (field.sort_order != null) onOrderChange(field.field_key, field.is_visible, null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setOrderDraft(field.sort_order?.toString() ?? "");
      return;
    }
    if (parsed === field.sort_order) return;
    onOrderChange(field.field_key, field.is_visible, parsed);
  }

  return (
    <li className="px-4 py-2 flex items-center justify-between gap-3">
      <span className={`text-sm ${field.is_visible ? "" : "text-gray-400"}`}>{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center gap-0.5">
          <input
            type="number"
            aria-label={t("fields.order_header", "סדר תצוגה")}
            className={`w-14 rounded-md border px-1.5 py-0.5 text-xs text-center ${
              duplicate
                ? "border-status-darkred text-status-darkred bg-red-50"
                : "border-gray-300"
            }`}
            placeholder="—"
            value={orderDraft}
            onChange={(e) => setOrderDraft(e.target.value)}
            onBlur={commitOrder}
          />
          {duplicate && (
            <span className="text-[10px] text-status-darkred whitespace-nowrap">
              {t("fields.order_dup", "כפול")}
            </span>
          )}
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
          {field.is_visible ? t("fields.shown", "מוצג") : t("fields.hidden", "מוסתר")}
          <input
            type="checkbox"
            className="h-4 w-4 accent-status-magenta"
            checked={field.is_visible}
            onChange={(e) => onToggle(field.field_key, e.target.checked)}
          />
        </label>
      </div>
    </li>
  );
}
