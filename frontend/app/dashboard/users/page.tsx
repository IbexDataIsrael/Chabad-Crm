"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { EmailInput } from "@/components/EmailInput";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useDbPreference } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import { useSortableList } from "@/lib/useSortableList";
import {
  contactFullName,
  type Area,
  type Building,
  type Contact,
  type ContactPage,
} from "@/lib/types";
import { EMAIL_HINT, PHONE_HINT, isValidEmail, isValidPhone } from "@/lib/validation";

interface OrgUser {
  id: number;
  guid: string;
  username: string;
  full_name: string;
  email: string | null;
  // fixes44 §1: was already a synced User column, just never returned by
  // the API — see schemas.UserOut.
  phone: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

type Role = "admin" | "staff" | "shliach";
type SortKey = "name" | "created";

/** fixes42 §4: a unified directory row — either a real login account
 *  (`/api/users`, any role) or, for shliach only, a contact whose login was
 *  deleted outright (`login_status === "missing"`) and so has no `User` row
 *  at all. Synthesizing the second kind preserves the recovery flow the
 *  standalone Shluchim page offered — otherwise a fully-deleted shliach
 *  login would simply vanish from view instead of staying recoverable. */
interface UserRow {
  kind: "user";
  key: string;
  id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
  login_status: "active" | "disabled";
  contactId: number | null;
  raw: OrgUser;
}
interface MissingLoginRow {
  kind: "missing_login";
  key: string;
  id: null;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: "shliach";
  is_active: false;
  created_at: string;
  login_status: "missing";
  contactId: number;
  raw: null;
}
type UnifiedRow = UserRow | MissingLoginRow;

const COLUMN_KEYS = ["email", "phone", "created"] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const DEFAULT_COLUMNS: ColumnKey[] = ["email", "phone", "created"];

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";
const toolbarSelectClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

/** Pages through /api/contacts/list (page_size capped at 100 server-side)
 *  until every matching shliach contact is collected — mirrors the same
 *  fetchAllPages pattern already used by dashboard/reports/create. */
async function fetchAllShliachContacts(
  areaIds: number[],
  buildingIds: number[],
): Promise<Contact[]> {
  const all: Contact[] = [];
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams();
    params.set("contact_type", "shliach");
    areaIds.forEach((id) => params.append("area_ids", String(id)));
    buildingIds.forEach((id) => params.append("building_ids", String(id)));
    params.set("page", String(page));
    params.set("page_size", "100");
    const res = await apiFetch<ContactPage>(`/api/contacts/list?${params}`);
    all.push(...res.items);
    if (all.length >= res.total || res.items.length === 0) break;
  }
  return all;
}

export default function UsersPage() {
  const router = useRouter();
  const { user: me, isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success, error: toastError } = useToast();

  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [shliachContacts, setShliachContacts] = useState<Contact[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OrgUser | null>(null);
  // fixes43 §3.3: the linked contact id for whichever row is being edited —
  // powers the "view contact" link inside the merged open/edit form.
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [recreatingKey, setRecreatingKey] = useState<string | null>(null);

  // fixes42 §4B: role filter, geo filters (shliach-only), inactive toggle,
  // column visibility + reorder — all persisted like the Contacts page.
  const [roleFilter, setRoleFilter] = usePersistentState<Role[]>("crm.users.role", []);
  const [areaIds, setAreaIds] = usePersistentState<number[]>("crm.users.areaIds", []);
  const [buildingIds, setBuildingIds] = usePersistentState<number[]>(
    "crm.users.buildingIds", [],
  );
  const [showInactive, setShowInactive] = usePersistentState(
    "crm.users.showInactive", false,
  );
  const [sort, setSort] = usePersistentState<SortKey>("crm.users.sort", "name");
  const [dir, setDir] = usePersistentState<"asc" | "desc">("crm.users.dir", "asc");
  const [page, setPage] = usePersistentState("crm.users.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.users.pageSize", 20);
  const [columns, setColumns] = useDbPreference<ColumnKey[]>("users.columns", DEFAULT_COLUMNS);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const { containerRef: columnsSortableRef, withClickGuard } =
    useSortableList<HTMLDivElement>(reorderColumns);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [loading, isAdmin, router]);

  async function reload() {
    setBusy(true);
    try {
      const [users, contacts] = await Promise.all([
        apiFetch<OrgUser[]>("/api/users"),
        fetchAllShliachContacts(areaIds, buildingIds),
      ]);
      setOrgUsers(users);
      setShliachContacts(contacts);
    } catch {
      setOrgUsers([]);
      setShliachContacts([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (loading || !isAdmin) return;
    reload().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAdmin, areaIds, buildingIds]);

  useEffect(() => {
    if (loading || !isAdmin) return;
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => {});
    apiFetch<Building[]>("/api/buildings").then(setBuildings).catch(() => {});
  }, [loading, isAdmin]);

  // fixes44 §1: one-field inline save straight from the list row — same
  // shape as the contacts page's saveField, merging the response back into
  // the row in place so scroll/filters/page stay put.
  async function saveUserField(row: UserRow, body: Record<string, unknown>) {
    const saved = await apiFetch<OrgUser>(`/api/users/${row.id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setOrgUsers((prev) => prev.map((u) => (u.id === row.id ? saved : u)));
  }

  if (loading || !isAdmin) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const roleLabel = (role: string) =>
    role === "admin"
      ? t("users.role_admin", "מנהל מערכת")
      : role === "shliach"
        ? t("users.role_shliach", "פעיל")
        : t("users.role_staff", "משתמש מוגבל");

  // fixes42 §4: build the unified row set — every /api/users account, plus a
  // synthetic row per shliach contact with no login at all.
  const contactsByEmail = new Map(
    shliachContacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]),
  );
  const userRows: UserRow[] = orgUsers.map((u) => {
    const role: Role = u.role === "admin" || u.role === "shliach" ? u.role : "staff";
    const matched =
      role === "shliach" && u.email ? contactsByEmail.get(u.email.toLowerCase()) ?? null : null;
    return {
      kind: "user",
      key: `u${u.id}`,
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      // fixes44 §1: the User row is authoritative (kept in sync with a
      // linked contact by the PUT handler) — fall back to the matched
      // contact only for pre-sync legacy rows.
      phone: u.phone ?? matched?.phone ?? null,
      role,
      is_active: u.is_active,
      created_at: u.created_at,
      login_status: u.is_active ? "active" : "disabled",
      contactId: matched?.id ?? null,
      raw: u,
    };
  });
  const missingRows: MissingLoginRow[] = shliachContacts
    .filter((c) => c.login_status === "missing")
    .map((c) => ({
      kind: "missing_login",
      key: `c${c.id}`,
      id: null,
      full_name: contactFullName(c),
      email: c.email,
      phone: c.phone,
      role: "shliach",
      is_active: false,
      created_at: c.created_at,
      login_status: "missing",
      contactId: c.id,
      raw: null,
    }));

  // Geo filters only constrain shliach rows (their coverage areas/buildings)
  // — admin/staff rows have no geography and are always shown. `shliachContacts`
  // was itself fetched with the same area/building params, so a shliach USER
  // row whose email doesn't resolve to an entry there fell outside the filter.
  const geoFilterActive = areaIds.length > 0 || buildingIds.length > 0;
  const allRows: UnifiedRow[] = [...userRows, ...missingRows].filter((r) => {
    if (roleFilter.length > 0 && !roleFilter.includes(r.role)) return false;
    if (!showInactive && !r.is_active) return false;
    if (geoFilterActive && r.role === "shliach" && r.kind === "user") {
      if (!r.email || !contactsByEmail.has(r.email.toLowerCase())) return false;
    }
    return true;
  });

  const sorted = [...allRows].sort((a, b) => {
    const cmp =
      sort === "created"
        ? a.created_at.localeCompare(b.created_at)
        : a.full_name.localeCompare(b.full_name, "he");
    return dir === "desc" ? -cmp : cmp;
  });
  const lastPage = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, lastPage);
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(safePage * pageSize, sorted.length)))
    .replace("{total}", String(sorted.length));

  const columnLabels: Record<ColumnKey, string> = {
    email: t("contacts.email", "אימייל"),
    phone: t("contacts.phone", "טלפון"),
    created: t("contacts.created_at", "נוצר בתאריך"),
  };
  const activeColumns = columns.filter((k): k is ColumnKey =>
    (COLUMN_KEYS as readonly string[]).includes(k),
  );

  function toggleColumn(k: ColumnKey) {
    setColumns((prev) => (prev.includes(k) ? prev.filter((c) => c !== k) : [...prev, k]));
  }
  function reorderColumns(orderedKeys: string[]) {
    setColumns((prev) => {
      const activeSet = new Set(prev);
      const reordered = orderedKeys.filter((k): k is ColumnKey => activeSet.has(k as ColumnKey));
      return reordered.length > 0 ? reordered : prev;
    });
  }
  function moveActiveColumn(key: ColumnKey, delta: -1 | 1) {
    setColumns((prev) => {
      const idx = prev.indexOf(key);
      const to = idx + delta;
      if (idx === -1 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  }

  // fixes44 §1: inline editing matching the contacts page's InlineEdit
  // pattern — full_name/email are native User fields, always editable for a
  // real login row. Phone is only meaningfully synced when the row has a
  // linked contact (`contactId`); a row with no associated contact record
  // shows "-" and is left non-editable (InlineEdit's `disabled`), per the
  // unlinked/missing-data handling this section calls for.
  const inlineNameCell = (r: UserRow) => (
    <InlineEdit<string>
      value={r.full_name}
      display={<span>{r.full_name}</span>}
      validate={(v) => (v.trim() ? null : t("validation.name_required", "יש להזין שם פרטי"))}
      onSave={(v) => saveUserField(r, { full_name: v.trim() })}
      editor={(draft, setDraft) => (
        <input className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} />
      )}
    />
  );

  const inlineEmailCell = (r: UserRow) => (
    <InlineEdit<string>
      value={r.email ?? ""}
      display={r.email ? <span dir="ltr">{r.email}</span> : "—"}
      validate={(v) => (isValidEmail(v.trim()) ? null : t("validation.email_hint", EMAIL_HINT))}
      onSave={(v) => saveUserField(r, { email: v.trim() })}
      editor={(draft, setDraft) => (
        <input
          className={inputClass}
          dir="ltr"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
    />
  );

  const inlinePhoneCell = (r: UserRow) => (
    <InlineEdit<string>
      value={r.phone ?? ""}
      display={r.phone ? <span dir="ltr">{r.phone}</span> : "—"}
      disabled={r.contactId == null}
      validate={(v) =>
        v.trim() === "" || isValidPhone(v.trim())
          ? null
          : t("validation.phone_hint", PHONE_HINT)
      }
      onSave={(v) => saveUserField(r, { phone: v.trim() || null })}
      editor={(draft, setDraft) => (
        <input
          className={inputClass}
          dir="ltr"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
    />
  );

  function cell(r: UnifiedRow, k: ColumnKey) {
    switch (k) {
      case "email":
        return r.kind === "user" ? inlineEmailCell(r) : r.email ? <span dir="ltr">{r.email}</span> : "—";
      case "phone":
        return r.kind === "user" ? inlinePhoneCell(r) : r.phone ? <span dir="ltr">{r.phone}</span> : "—";
      case "created":
        return <span dir="ltr">{new Date(r.created_at).toLocaleDateString("he-IL")}</span>;
    }
  }

  // fixes42 §4C: role change directly from the row — admin/staff only (a
  // shliach's role is managed by its contact link, same guard UserForm uses).
  async function changeRole(row: UserRow, role: "admin" | "staff") {
    try {
      await apiFetch(`/api/users/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({ role }),
      });
      await reload();
      success(t("users.role_updated", "התפקיד עודכן"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  async function recreateLogin(r: UnifiedRow) {
    if (!r.email || recreatingKey !== null) return;
    setRecreatingKey(r.key);
    try {
      await apiFetch("/api/users/recreate", {
        method: "POST",
        body: JSON.stringify({ email: r.email }),
      });
      success(t("users.user_recreated", "המשתמש נוצר מחדש"));
      await reload();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setRecreatingKey(null);
    }
  }

  async function remove(row: UserRow) {
    if (!(await confirmDialog({ message: t("users.delete_confirm", "למחוק את המשתמש?"), detail: row.full_name })))
      return;
    try {
      await apiFetch(`/api/users/${row.id}`, { method: "DELETE" });
      await reload();
      success(t("users.deleted", "המשתמש נמחק"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  // fixes43 §3.4: "ניקוי שיבוצים" — clear the area assignment from every
  // shliach row in the current filtered view (role/area/building/inactive
  // filters), not just the current pagination slice — same "everything
  // currently matching the filters" scope as the bulk-edit endpoints.
  async function clearAssignments() {
    const ok = await confirmDialog({
      message: t(
        "users.clear_assignments_confirm",
        "אתה בטוח שברצונך למחוק את כל השיבוצים של הפעילים? פעולה זו בלתי הפיכה",
      ),
    });
    if (!ok) return;
    const contactIds = sorted
      .filter((r) => r.role === "shliach" && r.contactId != null)
      .map((r) => r.contactId as number);
    if (contactIds.length === 0) {
      toastError(t("users.no_assignments_to_clear", "אין שיבוצים לניקוי בתצוגה הנוכחית"));
      return;
    }
    try {
      const res = await apiFetch<{ updated: number }>(
        "/api/contacts/shliach/clear-areas",
        { method: "POST", body: JSON.stringify({ contact_ids: contactIds }) },
      );
      await reload();
      success(
        t("users.assignments_cleared", "השיבוצים נוקו עבור {n} פעילים").replace(
          "{n}",
          String(res.updated),
        ),
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  const buildingOptions = buildings
    .filter((b) => areaIds.length === 0 || (b.area_id != null && areaIds.includes(b.area_id)))
    .map((b) => ({
      id: b.id,
      label:
        (b.building_address ?? "").split(",")[0].trim() || b.building_name || `#${b.id}`,
    }));

  const roleOptions: { id: Role; label: string }[] = [
    { id: "admin", label: t("users.role_admin", "מנהל מערכת") },
    { id: "staff", label: t("users.role_staff", "משתמש מוגבל") },
    { id: "shliach", label: t("users.role_shliach", "פעיל") },
  ];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("users.title", "ניהול משתמשים")}</h1>
          <p className="text-sm text-gray-500">
            {t(
              "users.intro",
              "הוסף וערוך משתמשים בארגון. מנהל מקבל הרשאות מלאות; משתמש מוגבל רואה אנשי קשר בלבד.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setColumnsOpen((v) => !v)}
            className="rounded-md border border-gray-300 text-gray-600 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            ⚙ {t("columns.configure", "התאמת עמודות")}
          </button>
          {/* fixes43 §3.4: bulk-clear area assignments from the filtered view. */}
          <button
            type="button"
            onClick={clearAssignments}
            className="rounded-md border border-status-darkred text-status-darkred px-4 py-2 text-sm font-medium hover:bg-status-darkred/10"
          >
            {t("users.clear_assignments", "ניקוי שיבוצים")}
          </button>
          <Link
            href="/dashboard/contacts/new-shliach"
            className="rounded-md border border-status-magenta text-status-magenta px-4 py-2 text-sm font-medium hover:bg-status-magenta/10"
          >
            + {t("page.add_shliach", "הוסף פעיל")}
          </Link>
          {!adding && (
            <button
              onClick={() => {
                setAdding(true);
                setEditing(null);
              }}
              className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
            >
              + {t("users.add_user", "משתמש חדש")}
            </button>
          )}
        </div>
      </div>

      {adding && (
        <UserForm
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await reload();
            success(t("users.created", "המשתמש נוצר ונשלח אליו מייל קבלת פנים"));
          }}
        />
      )}

      {editing && (
        <UserForm
          user={editing}
          contactId={editingContactId}
          onClose={() => {
            setEditing(null);
            setEditingContactId(null);
          }}
          onSaved={async () => {
            setEditing(null);
            setEditingContactId(null);
            await reload();
            success(t("users.updated", "המשתמש עודכן"));
          }}
        />
      )}

      {/* fixes42 §4B3: column visibility + reorder — same chip/SortableJS
          pattern the Contacts and Reports pages already use. */}
      {columnsOpen && (
        <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("columns.title", "עמודות מוצגות")}</h3>
            <button
              type="button"
              onClick={() => setColumns(DEFAULT_COLUMNS)}
              className="text-xs text-status-magenta hover:underline"
            >
              {t("columns.reset", "איפוס ברירת מחדל")}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            {t("columns.reorder_hint", "גרור עמודה פעילה כדי לשנות את סדר ההצגה.")}
          </p>
          <div ref={columnsSortableRef} className="flex flex-wrap gap-2">
            {activeColumns.map((k) => {
              const activeIdx = activeColumns.indexOf(k);
              return (
                <span key={k} data-sort-key={k} className="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={withClickGuard(() => toggleColumn(k))}
                    className="rounded-md border px-3 py-1.5 text-sm border-status-magenta bg-status-magenta/10 text-status-magenta cursor-grab active:cursor-grabbing"
                  >
                    ⠿ {columnLabels[k]}
                  </button>
                  <span className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={activeIdx === 0}
                      onClick={() => moveActiveColumn(k, -1)}
                      title={t("action.move_up", "העלה")}
                      className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-gray-400 hover:text-status-magenta hover:bg-gray-50 active:bg-gray-100 disabled:opacity-20"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={activeIdx === activeColumns.length - 1}
                      onClick={() => moveActiveColumn(k, 1)}
                      title={t("action.move_down", "הורד")}
                      className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-gray-400 hover:text-status-magenta hover:bg-gray-50 active:bg-gray-100 disabled:opacity-20"
                    >
                      ▼
                    </button>
                  </span>
                </span>
              );
            })}
            {COLUMN_KEYS.filter((k) => !activeColumns.includes(k)).map((k) => (
              <button
                key={k}
                type="button"
                data-sort-key={k}
                data-sortable-disabled=""
                onClick={() => toggleColumn(k)}
                className="rounded-md border px-3 py-1.5 text-sm border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                {columnLabels[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* fixes42 §4B1/§4B4: role filter + inactive toggle, plus the geo
          filters carried over from the standalone Shluchim page (shliach
          coverage only — admin/staff rows are unaffected by them). */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <MultiSelectFilter
          allLabel={t("filter.all_roles", "כל התפקידים")}
          options={roleOptions}
          value={roleFilter}
          onChange={(ids) => {
            setRoleFilter(ids);
            setPage(1);
          }}
        />
        <MultiSelectFilter
          allLabel={t("filter.all_areas", "כל האזורים")}
          options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
          value={areaIds}
          onChange={(ids) => {
            setAreaIds(ids);
            setBuildingIds((prev) =>
              ids.length === 0
                ? prev
                : prev.filter((bid) =>
                    buildings.some(
                      (b) => b.id === bid && b.area_id != null && ids.includes(b.area_id),
                    ),
                  ),
            );
            setPage(1);
          }}
        />
        <MultiSelectFilter
          allLabel={t("filter.all_buildings", "כל הבניינים")}
          options={buildingOptions}
          value={buildingIds}
          onChange={(ids) => {
            setBuildingIds(ids);
            setPage(1);
          }}
        />
        <label className="inline-flex items-center gap-1.5 cursor-pointer text-gray-500">
          <input
            type="checkbox"
            className="accent-status-magenta"
            checked={showInactive}
            onChange={(e) => {
              setShowInactive(e.target.checked);
              setPage(1);
            }}
          />
          {t("users.show_inactive", "הצג משתמשים לא פעילים")}
        </label>
        <span className="flex items-center gap-2 text-gray-500">
          {t("sort.label", "מיון:")}
          <select
            className={toolbarSelectClass}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(1);
            }}
          >
            <option value="name">{t("sort.by_name", "שם")}</option>
            <option value="created">{t("sort.created", "תאריך יצירה")}</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setDir(dir === "asc" ? "desc" : "asc");
              setPage(1);
            }}
            className="rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50"
            title={dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
        </span>
        <span className="ms-auto flex items-center gap-2 text-gray-500">
          {t("pager.page_size", "בעמוד:")}
          <select
            className={toolbarSelectClass}
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      </div>

      {/* fixes44 §1: layout/table structure aligned to the contacts page —
          same header/cell padding, alignment, and a trailing full-width
          column so data columns condense to the start. */}
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-right">
            <tr>
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">{t("common.name", "שם")}</th>
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">{t("users.role_label", "תפקיד")}</th>
              {activeColumns.map((k) => (
                <th key={k} className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {columnLabels[k]}
                </th>
              ))}
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap" />
              <th className="w-full" />
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={4 + activeColumns.length} className="px-4 py-6 text-center text-gray-400">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={4 + activeColumns.length} className="px-4 py-6 text-center text-gray-400">
                  {t("users.none", "אין משתמשים.")}
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.key} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                    {r.kind === "user" ? inlineNameCell(r) : r.full_name}
                    {r.kind === "user" && me?.id === r.id && (
                      <span className="ms-2 text-xs text-gray-400">({t("users.you", "אני")})</span>
                    )}
                    {r.role === "shliach" && r.login_status !== "active" && (
                      <span className="ms-2 inline-flex items-center gap-2">
                        <span className="rounded bg-red-50 border border-status-darkred/40 text-status-darkred text-xs px-2 py-0.5">
                          {r.login_status === "missing"
                            ? t("users.login_missing", "אין כניסה למערכת")
                            : t("users.login_suspended", "הכניסה למערכת הושעתה")}
                        </span>
                        {r.email && (
                          <button
                            type="button"
                            onClick={() => recreateLogin(r)}
                            disabled={recreatingKey !== null}
                            className="rounded-md bg-status-darkred text-white px-2 py-0.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                          >
                            {recreatingKey === r.key
                              ? t("action.saving", "שומר…")
                              : t("users.recreate_user", "צור משתמש מחדש")}
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 w-px whitespace-nowrap">
                    {r.role !== "admin" && r.role !== "staff" ? (
                      <span className="rounded px-2 py-0.5 text-xs bg-gray-100 text-gray-600">
                        {roleLabel(r.role)}
                      </span>
                    ) : (
                      <select
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-status-magenta focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                        value={r.role}
                        disabled={me?.id === r.id}
                        onChange={(e) => changeRole(r, e.target.value as "admin" | "staff")}
                      >
                        <option value="staff">{t("users.role_staff", "משתמש מוגבל")}</option>
                        <option value="admin">{t("users.role_admin", "מנהל מערכת")}</option>
                      </select>
                    )}
                  </td>
                  {activeColumns.map((k) => (
                    <td key={k} className="px-3 py-1.5 w-px whitespace-nowrap">
                      {cell(r, k)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 w-px whitespace-nowrap">
                    {/* fixes43 §3.3: one unified "open/edit" action — a real
                        user row opens the inline form (role/email/password),
                        which itself carries a link to the linked contact when
                        one exists; a contact-only row (no login) still just
                        links straight to the contact page. */}
                    {r.kind === "user" ? (
                      <button
                        onClick={() => {
                          setEditing(r.raw);
                          setEditingContactId(r.contactId);
                          setAdding(false);
                        }}
                        className="text-sm text-status-magenta hover:underline me-3"
                      >
                        {t("action.open_edit", "פתח / עריכה ›")}
                      </button>
                    ) : (
                      r.contactId != null && (
                        <Link
                          href={`/dashboard/contacts/${r.contactId}`}
                          className="text-sm text-status-magenta hover:underline me-3"
                        >
                          {t("action.open_edit", "פתח / עריכה ›")}
                        </Link>
                      )
                    )}
                    {r.kind === "user" && me?.id !== r.id && (
                      <button
                        onClick={() => remove(r)}
                        className="text-sm text-status-darkred hover:underline"
                      >
                        {t("action.delete", "מחק")}
                      </button>
                    )}
                  </td>
                  <td />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!busy && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-gray-500">{rangeText}</span>
          <button
            type="button"
            disabled={safePage >= lastPage}
            onClick={() => setPage(safePage + 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.next", "הבא ←")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Create (no `user`) or edit (with `user`) an org user, role included.
 *  fixes43 §3.3: `contactId`, when the edited user has a linked contact
 *  (shliach), surfaces a "view contact" link — this form is now the single
 *  "open/edit" action for a Users row, merging what used to be two separate
 *  actions (edit user vs. open contact). */
function UserForm({
  user,
  contactId,
  onClose,
  onSaved,
}: {
  user?: OrgUser;
  contactId?: number | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { user: me } = useAuth();
  const { t } = useLocalization();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState(user?.role === "admin" ? "admin" : "staff");
  const [password, setPassword] = useState("");
  const [emailValid, setEmailValid] = useState(!!user);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isSelf = user != null && me?.id === user.id;
  // fixes14: a shliach's role is managed by its contact link — never send a
  // role for them (it silently demoted the account to staff).
  const isShliachAccount = user?.role === "shliach";

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!emailValid) {
      setError(t("msg.invalid_email", "כתובת אימייל לא תקינה"));
      return;
    }
    setBusy(true);
    try {
      if (user) {
        await apiFetch(`/api/users/${user.id}`, {
          method: "PUT",
          body: JSON.stringify({
            full_name: fullName,
            // fixes14: email is editable and syncs to a linked shliach contact.
            ...(email && email !== (user.email ?? "") ? { email } : {}),
            ...(isSelf || isShliachAccount ? {} : { role }),
            ...(password ? { password } : {}),
          }),
        });
      } else {
        await apiFetch("/api/users", {
          method: "POST",
          body: JSON.stringify({
            full_name: fullName,
            email,
            role,
            password: password || null,
          }),
        });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">
          {user ? `${t("action.edit", "ערוך")} — ${user.full_name}` : t("users.add_user", "משתמש חדש")}
        </h3>
        {contactId != null && (
          <Link
            href={`/dashboard/contacts/${contactId}`}
            className="text-sm text-status-magenta hover:underline whitespace-nowrap"
          >
            {t("users.view_contact", "צפייה באיש הקשר ›")}
          </Link>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("users.full_name", "שם מלא")}</span>
          <input
            className={inputClass}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("contacts.email", "אימייל")}</span>
          <EmailInput value={email} onChange={setEmail} onValidityChange={setEmailValid} required />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("users.role_label", "תפקיד")}</span>
          {isShliachAccount ? (
            // fixes14: the shliach role is fixed (managed by the contact link).
            <input
              className={inputClass}
              value={t("users.role_shliach", "פעיל")}
              disabled
            />
          ) : (
            <select
              className={inputClass}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={isSelf}
            >
              <option value="staff">{t("users.role_staff", "משתמש מוגבל")}</option>
              <option value="admin">{t("users.role_admin", "מנהל מערכת")}</option>
            </select>
          )}
          {isSelf && (
            <span className="block text-xs text-gray-400">
              {t("users.self_guard", "לא ניתן לשנות או למחוק את עצמך")}
            </span>
          )}
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">
            {t("users.password_optional", "סיסמה (לא חובה)")}
          </span>
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <span className="block text-xs text-gray-400">
            {t(
              "users.google_only_hint",
              "ללא סיסמה — המשתמש יתחבר עם Google לפי כתובת האימייל המאומתת.",
            )}
          </span>
        </label>
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
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </form>
  );
}
