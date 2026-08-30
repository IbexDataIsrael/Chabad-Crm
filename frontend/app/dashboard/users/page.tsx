"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AreaMultiSelect } from "@/components/AreaMultiSelect";
import { CustomFieldValueDisplay, CustomFieldValueInput } from "@/components/CustomFieldValueInput";
import { EmailInput } from "@/components/EmailInput";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { PicklistSelect } from "@/components/PicklistSelect";
import { ReportNumberMultiSelect } from "@/components/ReportNumberMultiSelect";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { MultiSelectEditor } from "@/components/ui/MultiSelectEditor";
import { TruncatedText } from "@/components/ui/TruncatedText";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useLocalization } from "@/lib/localization";
import { usePicklistsMap } from "@/lib/picklists";
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
  type CustomFieldDefinition,
  type PicklistField,
  type ReportNumber,
  type Shliach,
} from "@/lib/types";
import { EMAIL_HINT, PHONE_HINT, isValidEmail, isValidPhone } from "@/lib/validation";

export interface OrgUser {
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
  // fixes46: the linked ContactShliach (role='shliach' only), resolved
  // server-side by the real user_id FK — see schemas.UserOut.shliach.
  shliach: Shliach | null;
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

// fixes46: notes/areas/report_numbers are the rest of ContactShliach's real
// columns (full_name/email/phone already had cells) — opt-in like the
// existing optional ones, so an existing user's default view is unchanged.
const COLUMN_KEYS = ["email", "phone", "notes", "areas", "report_numbers", "created"] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const DEFAULT_COLUMNS: ColumnKey[] = ["email", "phone", "created"];

// fixes48 §2/§3: one grid column, whichever of the 3 kinds it is — feeds the
// unified drag-reorder list (Customize Columns panel + the table itself),
// same mechanism as the Contacts page.
type GridColumn =
  | { kind: "col"; key: ColumnKey }
  | { kind: "pl"; key: string; def: PicklistField }
  | { kind: "cfield"; key: string; def: CustomFieldDefinition };

function gridColumnSortKey(entry: GridColumn): string {
  return `${entry.kind}:${entry.key}`;
}

// fixes49 §1: per-column min-width so short values (dates, badges) don't get
// squeezed in the RTL grid — free-text-prone columns get the wider floor.
const WIDE_GRID_COLUMN_KEYS = new Set<ColumnKey>(["email", "notes", "areas", "report_numbers"]);
function gridColumnMinWidth(entry: GridColumn): string {
  if (entry.kind === "cfield") {
    return entry.def.field_type === "text" ? "min-w-[150px]" : "min-w-[120px]";
  }
  if (entry.kind === "col" && WIDE_GRID_COLUMN_KEYS.has(entry.key)) return "min-w-[150px]";
  return "min-w-[120px]";
}

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
  // fixes46: display names for the areas/report_numbers columns.
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  // fixes46: any admin-added contact_shliach custom picklist / non-select
  // custom field — same "dynamic column" treatment the Contacts page gives
  // contact_mekurav's (see useCustomFieldDefs + the /api/picklists filter).
  const [shliachPicklistDefs, setShliachPicklistDefs] = useState<PicklistField[]>([]);
  const shliachCustomFieldDefs = useCustomFieldDefs("contact_shliach").filter(
    (d) => d.field_type !== "select",
  );
  const shliachPicklists = usePicklistsMap(shliachPicklistDefs.map((d) => d.field_key));
  // fixes50 §4.1: this used to store which columns were VISIBLE — so the
  // moment an admin hid even one column, the array became explicit, and any
  // custom field/picklist created afterward (never a member of that array)
  // silently defaulted to hidden instead of showing up like a brand-new
  // built-in column would. Storing which columns are HIDDEN instead makes a
  // field absent from the list mean "never hidden" — i.e. visible by
  // default, matching every other column on this page. Renamed the
  // preference keys so a stale "visible" list from before this fix is never
  // misread as a "hidden" list.
  const [hiddenShliachPicklistKeys, setHiddenShliachPicklistKeys] = useDbPreference<
    string[]
  >("users.shliachPicklistsHidden", []);
  const [hiddenShliachFieldKeys, setHiddenShliachFieldKeys] = useDbPreference<
    string[]
  >("users.shliachCustomFieldsHidden", []);
  function toggleShliachPicklistColumn(fieldKey: string) {
    setHiddenShliachPicklistKeys((prev) =>
      prev.includes(fieldKey) ? prev.filter((k) => k !== fieldKey) : [...prev, fieldKey],
    );
  }
  function toggleShliachFieldColumn(fieldKey: string) {
    setHiddenShliachFieldKeys((prev) =>
      prev.includes(fieldKey) ? prev.filter((k) => k !== fieldKey) : [...prev, fieldKey],
    );
  }
  const [adding, setAdding] = useState(false);
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
  // fixes48 §3: column filtering across the report_numbers column and every
  // dynamic contact_shliach picklist/custom field — same "shliach-only,
  // admin/staff rows unaffected" scope as the geo filters above.
  const [reportNumberIds, setReportNumberIds] = usePersistentState<number[]>(
    "crm.users.reportNumberIds", [],
  );
  const [shliachPicklistFilters, setShliachPicklistFilters] = usePersistentState<
    Record<string, string[]>
  >("crm.users.shliachPicklistFilters", {});
  // Boolean fields store "true"/"false"; text/number/date fields store a
  // free-text "contains" query. "" (unset) means no filter for that field.
  const [shliachFieldFilters, setShliachFieldFilters] = usePersistentState<
    Record<string, string>
  >("crm.users.shliachFieldFilters", {});
  const [sort, setSort] = usePersistentState<SortKey>("crm.users.sort", "name");
  const [dir, setDir] = usePersistentState<"asc" | "desc">("crm.users.dir", "asc");
  const [page, setPage] = usePersistentState("crm.users.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.users.pageSize", 20);
  const [columns, setColumns] = useDbPreference<ColumnKey[]>("users.columns", DEFAULT_COLUMNS);
  // fixes48 §3: one relative order spanning fixed AND custom (picklist +
  // field) columns — see the Contacts page's identical mechanism.
  const [columnOrder, setColumnOrder] = useDbPreference<string[]>("users.columnOrder", []);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const { containerRef: columnsSortableRef, withClickGuard } =
    useSortableList<HTMLDivElement>(reorderColumns);

  // fixes52 §5: a shliach landing here (direct URL — the nav link is
  // admin-only) goes to their own contact profile instead of the generic
  // dashboard, when one exists.
  useEffect(() => {
    if (loading || isAdmin) return;
    router.replace(
      me?.role === "shliach" && me.shliach?.contact_id
        ? `/dashboard/contacts/${me.shliach.contact_id}`
        : "/dashboard",
    );
  }, [loading, isAdmin, me, router]);

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
    apiFetch<ReportNumber[]>("/api/report-numbers").then(setReportNumbers).catch(() => {});
    // fixes46: any admin-added contact_shliach picklist (entity_type is real
    // data, mirrors the contacts/apartments pages' own customDefs fetch).
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) => setShliachPicklistDefs(defs.filter((d) => d.entity_type === "contact_shliach")))
      .catch(() => setShliachPicklistDefs([]));
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

  // fixes46: contact_shliach custom fields/picklists live on the linked
  // Contact record (picklist_values/custom_field_values), not on the User —
  // saved via the contacts API and merged back into `shliachContacts` (the
  // source `cell()` reads them from), same pattern as saveUserField above.
  async function saveShliachContactField(contactId: number, body: Record<string, unknown>) {
    const saved = await apiFetch<Contact>(`/api/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setShliachContacts((prev) => prev.map((c) => (c.id === contactId ? saved : c)));
  }

  if (loading || !isAdmin) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const roleLabel = (role: string) =>
    role === "admin"
      ? t("users.role_admin", "מנהל מערכת")
      : role === "shliach"
        ? t("users.role_shliach", "פעיל")
        : t("users.role_staff", "משתמש מוגבל");

  // fixes46: contact_shliach custom-field/picklist values live on the linked
  // Contact record, fetched in bulk by fetchAllShliachContacts (ContactOut
  // already carries picklist_values/custom_field_values on /list) — looked
  // up by the *real* contact_id from u.shliach, not by an email guess.
  const shliachContactsById = new Map(shliachContacts.map((c) => [c.id, c]));

  // fixes42 §4: build the unified row set — every /api/users account, plus a
  // synthetic row per shliach contact with no login at all.
  // fixes46: contactId/phone/coverage now come straight from the backend's
  // real ContactShliach.user_id link (UserOut.shliach) instead of matching
  // contacts by email — the old heuristic silently broke when a shliach's
  // login email differed from their contact record's email.
  const userRows: UserRow[] = orgUsers.map((u) => {
    const role: Role = u.role === "admin" || u.role === "shliach" ? u.role : "staff";
    return {
      kind: "user",
      key: `u${u.id}`,
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      phone: u.phone ?? u.shliach?.phone ?? null,
      role,
      is_active: u.is_active,
      created_at: u.created_at,
      login_status: u.is_active ? "active" : "disabled",
      contactId: u.shliach?.contact_id ?? null,
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

  // Geo filters only constrain shliach rows (their coverage areas/buildings,
  // i.e. ContactShliach.area_ids) — admin/staff rows have no geography and
  // are always shown. Mirrors the backend's own contact_type=shliach
  // area_ids/building_ids resolution (routers/contacts.py:_contacts_query):
  // a building matches when it sits in one of the shliach's covered areas.
  const geoFilterActive = areaIds.length > 0 || buildingIds.length > 0;
  function shliachMatchesGeo(sh: Shliach | null | undefined): boolean {
    if (!sh) return false;
    if (areaIds.length > 0 && !sh.area_ids.some((id) => areaIds.includes(id))) return false;
    if (buildingIds.length > 0) {
      const covered = new Set(sh.area_ids);
      const inCoveredArea = buildings.some(
        (b) => buildingIds.includes(b.id) && b.area_id != null && covered.has(b.area_id),
      );
      if (!inCoveredArea) return false;
    }
    return true;
  }
  // fixes48 §3: report_numbers / custom picklist / custom field values all
  // live on the linked Contact record (same source shliachContactsById
  // already resolves for the notes/areas/report_numbers columns).
  function contactFor(r: UnifiedRow): Contact | undefined {
    return r.contactId != null ? shliachContactsById.get(r.contactId) : undefined;
  }
  const reportNumberFilterActive = reportNumberIds.length > 0;
  // Only the currently-existing defs' filters apply — a stale filter for a
  // field that was since deleted/hidden must not keep silently filtering.
  const effectiveShliachPicklistFilters = Object.fromEntries(
    Object.entries(shliachPicklistFilters).filter(([k, v]) =>
      v.length > 0 && shliachPicklistDefs.some((d) => d.field_key === k),
    ),
  );
  const effectiveShliachFieldFilters = Object.fromEntries(
    Object.entries(shliachFieldFilters).filter(([k, v]) =>
      v !== "" && shliachCustomFieldDefs.some((d) => d.field_key === k),
    ),
  );
  const allRows: UnifiedRow[] = [...userRows, ...missingRows].filter((r) => {
    if (roleFilter.length > 0 && !roleFilter.includes(r.role)) return false;
    if (!showInactive && !r.is_active) return false;
    if (geoFilterActive && r.role === "shliach" && r.kind === "user") {
      if (!shliachMatchesGeo(r.raw.shliach)) return false;
    }
    if (r.role === "shliach") {
      if (reportNumberFilterActive) {
        const ids = contactFor(r)?.shliach?.report_number_ids ?? [];
        if (!ids.some((id) => reportNumberIds.includes(id))) return false;
      }
      for (const [key, values] of Object.entries(effectiveShliachPicklistFilters)) {
        const val = contactFor(r)?.picklist_values?.[key] ?? null;
        if (val == null || !values.includes(val)) return false;
      }
      for (const [key, query] of Object.entries(effectiveShliachFieldFilters)) {
        const def = shliachCustomFieldDefs.find((d) => d.field_key === key);
        const val = contactFor(r)?.custom_field_values?.[key];
        if (def?.field_type === "boolean") {
          if (Boolean(val) !== (query === "true")) return false;
        } else if (!String(val ?? "").toLowerCase().includes(query.toLowerCase())) {
          return false;
        }
      }
    }
    // Admin/staff rows have no shliach data at all — same "unaffected by
    // shliach-only filters" convention the geo filters already follow.
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
    notes: t("contact_shliach.notes", "הערות"),
    areas: t("contact_shliach.areas", "אזורים באחריות הפעיל"),
    report_numbers: t("contact_shliach.report_numbers", "מספרי דוח באחריות הפעיל"),
    created: t("contacts.created_at", "נוצר בתאריך"),
  };
  function toggleColumn(k: ColumnKey) {
    setColumns((prev) => (prev.includes(k) ? prev.filter((c) => c !== k) : [...prev, k]));
  }
  function gridColumnLabel(entry: GridColumn): string {
    if (entry.kind === "col") return columnLabels[entry.key];
    if (entry.kind === "pl") return entry.def.label || entry.def.field_key;
    return entry.def.hebrew_label || entry.def.field_key;
  }

  // fixes48 §3: fixed + custom-picklist + custom-field columns unified into
  // one draggable/orderable list — mirrors the Contacts page's identical
  // mechanism (see its comments for the full rationale).
  const allGridColumns: GridColumn[] = [
    ...COLUMN_KEYS.map((key): GridColumn => ({ kind: "col", key })),
    ...shliachPicklistDefs.map(
      (def): GridColumn => ({ kind: "pl", key: def.field_key, def }),
    ),
    ...shliachCustomFieldDefs.map(
      (def): GridColumn => ({ kind: "cfield", key: def.field_key, def }),
    ),
  ];

  function isGridColumnActive(entry: GridColumn): boolean {
    if (entry.kind === "col") return columns.includes(entry.key);
    if (entry.kind === "pl") return !hiddenShliachPicklistKeys.includes(entry.key);
    return !hiddenShliachFieldKeys.includes(entry.key);
  }

  function toggleGridColumn(entry: GridColumn) {
    if (entry.kind === "col") return toggleColumn(entry.key);
    if (entry.kind === "pl") return toggleShliachPicklistColumn(entry.key);
    toggleShliachFieldColumn(entry.key);
  }

  const columnOrderIndex = new Map(columnOrder.map((k, i) => [k, i]));
  const sortedGridColumns = [...allGridColumns].sort((a, b) => {
    const ai = columnOrderIndex.get(gridColumnSortKey(a)) ?? Number.MAX_SAFE_INTEGER;
    const bi = columnOrderIndex.get(gridColumnSortKey(b)) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
  const orderedActiveColumns = sortedGridColumns.filter(isGridColumnActive);
  const colCount = 4 + orderedActiveColumns.length;

  function reorderColumns(orderedKeys: string[]) {
    if (orderedKeys.length > 0) setColumnOrder(orderedKeys);
  }

  function moveActiveColumn(entry: GridColumn, delta: -1 | 1) {
    const idx = orderedActiveColumns.findIndex(
      (e) => gridColumnSortKey(e) === gridColumnSortKey(entry),
    );
    const to = idx + delta;
    if (idx === -1 || to < 0 || to >= orderedActiveColumns.length) return;
    const fullKeys = sortedGridColumns.map(gridColumnSortKey);
    const ia = fullKeys.indexOf(gridColumnSortKey(orderedActiveColumns[idx]));
    const ib = fullKeys.indexOf(gridColumnSortKey(orderedActiveColumns[to]));
    [fullKeys[ia], fullKeys[ib]] = [fullKeys[ib], fullKeys[ia]];
    setColumnOrder(fullKeys);
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
      display={<TruncatedText text={r.full_name} />}
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
      display={
        r.email ? (
          <span dir="ltr">
            <TruncatedText text={r.email} />
          </span>
        ) : (
          "—"
        )
      }
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

  // fixes46: notes/areas/report_numbers are the rest of ContactShliach's
  // columns — same "unlinked ⇒ dash + disabled" contract as phone. A
  // `missing_login` row has no `raw` User but still has its own shliach data
  // (read straight off the Contact fetched via `/list`), so it renders the
  // same values read-only (no PUT /api/users endpoint backs a contact-only
  // row from this page).
  function areaNamesText(ids: number[]): string {
    if (ids.length === 0) return "—";
    const byId = new Map(areas.map((a) => [a.id, a.area_name]));
    return ids.map((id) => byId.get(id) ?? `#${id}`).join(", ");
  }
  function reportNumberNamesText(ids: number[]): string {
    if (ids.length === 0) return "—";
    const byId = new Map(reportNumbers.map((rn) => [rn.id, rn.name]));
    return ids.map((id) => byId.get(id) ?? `#${id}`).join(", ");
  }

  const inlineNotesCell = (r: UserRow) => (
    <InlineEdit<string>
      value={r.raw.shliach?.notes ?? ""}
      display={
        r.raw.shliach?.notes ? <TruncatedText text={r.raw.shliach.notes} /> : "—"
      }
      disabled={r.contactId == null}
      onSave={(v) => saveUserField(r, { shliach: { notes: v.trim() || null } })}
      editor={(draft, setDraft) => (
        <textarea
          className={inputClass}
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
    />
  );

  // fixes47: area/report-number pickers can't rely on InlineEdit's default
  // commit-on-blur (see MultiSelectEditor's doc comment for why — clicking
  // away silently never saved) — commitOnBlur is off, an explicit apply
  // button drives the save instead, and a toast confirms it landed.
  const inlineAreasCell = (r: UserRow) => (
    <InlineEdit<number[]>
      value={r.raw.shliach?.area_ids ?? []}
      display={<TruncatedText text={areaNamesText(r.raw.shliach?.area_ids ?? [])} />}
      disabled={r.contactId == null}
      commitOnBlur={false}
      onSave={async (ids) => {
        await saveUserField(r, { shliach: { area_ids: ids } });
        success(t("contact_shliach.areas_saved", "האזורים נשמרו"));
      }}
      editor={(draft, setDraft, commit) => (
        <MultiSelectEditor onApply={() => commit(draft)}>
          <AreaMultiSelect
            value={draft}
            onChange={setDraft}
            excludeContactId={r.contactId ?? undefined}
          />
        </MultiSelectEditor>
      )}
    />
  );

  const inlineReportNumbersCell = (r: UserRow) => (
    <InlineEdit<number[]>
      value={r.raw.shliach?.report_number_ids ?? []}
      display={
        <TruncatedText text={reportNumberNamesText(r.raw.shliach?.report_number_ids ?? [])} />
      }
      disabled={r.contactId == null}
      commitOnBlur={false}
      onSave={async (ids) => {
        await saveUserField(r, { shliach: { report_number_ids: ids } });
        success(t("contact_shliach.report_numbers_saved", "מספרי הדוח נשמרו"));
      }}
      editor={(draft, setDraft, commit) => (
        <MultiSelectEditor onApply={() => commit(draft)}>
          <ReportNumberMultiSelect
            value={draft}
            onChange={setDraft}
            excludeContactId={r.contactId ?? undefined}
          />
        </MultiSelectEditor>
      )}
    />
  );

  // fixes46: any admin-added contact_shliach picklist/custom field — reads
  // and writes the linked Contact directly (these values live there, not on
  // the User). Unlinked rows (`contactId == null`) just show "—", same as
  // every other shliach-only column.
  const inlineShliachPicklistCell = (r: UnifiedRow, d: PicklistField) => {
    const c = r.contactId != null ? shliachContactsById.get(r.contactId) : undefined;
    const value = c?.picklist_values?.[d.field_key] ?? null;
    const display = <TruncatedText text={shliachPicklists.labelFor(d.field_key, value) || "—"} />;
    if (r.contactId == null) return display;
    return (
      <InlineEdit<string | null>
        value={value}
        display={display}
        commitOnBlur={false}
        onSave={(v) =>
          saveShliachContactField(r.contactId as number, { picklist_values: { [d.field_key]: v } })
        }
        editor={(draft, _setDraft, commit) => (
          <PicklistSelect fieldKey={d.field_key} value={draft} onChange={commit} />
        )}
      />
    );
  };

  const inlineShliachCustomFieldCell = (r: UnifiedRow, d: CustomFieldDefinition) => {
    const c = r.contactId != null ? shliachContactsById.get(r.contactId) : undefined;
    const value = c?.custom_field_values?.[d.field_key] ?? null;
    const display =
      d.field_type === "text" && typeof value === "string" ? (
        <TruncatedText text={value} />
      ) : (
        <CustomFieldValueDisplay fieldType={d.field_type} value={value} />
      );
    if (r.contactId == null) return display;
    return (
      <InlineEdit<string | number | boolean | null>
        value={value}
        display={display}
        commitOnBlur={d.field_type === "text" || d.field_type === "number"}
        onSave={(v) =>
          saveShliachContactField(r.contactId as number, { custom_field_values: { [d.field_key]: v } })
        }
        editor={(draft, setDraft, commit) => (
          <CustomFieldValueInput
            fieldType={d.field_type}
            value={draft}
            onChange={d.field_type === "boolean" || d.field_type === "date" ? commit : setDraft}
          />
        )}
      />
    );
  };

  function cell(r: UnifiedRow, k: ColumnKey) {
    switch (k) {
      case "email":
        return r.kind === "user" ? (
          inlineEmailCell(r)
        ) : r.email ? (
          <span dir="ltr">
            <TruncatedText text={r.email} />
          </span>
        ) : (
          "—"
        );
      case "phone":
        return r.kind === "user" ? inlinePhoneCell(r) : r.phone ? <span dir="ltr">{r.phone}</span> : "—";
      case "notes":
        return r.kind === "user" ? (
          inlineNotesCell(r)
        ) : (
          <TruncatedText text={shliachContactsById.get(r.contactId)?.shliach?.notes ?? "—"} />
        );
      case "areas":
        return r.kind === "user" ? (
          inlineAreasCell(r)
        ) : (
          <TruncatedText
            text={areaNamesText(shliachContactsById.get(r.contactId)?.shliach?.area_ids ?? [])}
          />
        );
      case "report_numbers":
        return r.kind === "user" ? (
          inlineReportNumbersCell(r)
        ) : (
          <TruncatedText
            text={reportNumberNamesText(
              shliachContactsById.get(r.contactId)?.shliach?.report_number_ids ?? [],
            )}
          />
        );
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

  // fixes43 §3.4 / fixes48 §3: "ניקוי שיבוצים" — clear the report-number
  // assignment (NOT the area) from every shliach row in the current filtered
  // view (role/area/building/inactive filters), not just the current
  // pagination slice — same "everything currently matching the filters"
  // scope as the bulk-edit endpoints. fixes48: this originally called
  // /clear-areas and wiped the area assignment instead — area must survive.
  async function clearAssignments() {
    const ok = await confirmDialog({
      message: t(
        "users.clear_assignments_confirm",
        "אתה בטוח שברצונך למחוק את כל מספרי הדוח המשויכים לפעילים? פעולה זו בלתי הפיכה",
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
        "/api/contacts/shliach/clear-report-numbers",
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
    <div className="space-y-4">
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
        {/* fixes47: flex-wrap so the button row folds onto extra lines on
            narrow viewports instead of overflowing horizontally — same
            treatment fixes44 §2 gave the Contacts page's own button row. */}
        <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => setAdding(true)}
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
          {/* fixes48 §3: one unified SortableJS-managed container for every
              chip — fixed AND custom, active or not — same mechanism as the
              Contacts page (previously custom columns were pinned after the
              fixed ones with no relative ordering of their own). */}
          <div ref={columnsSortableRef} className="flex flex-wrap gap-2">
            {orderedActiveColumns.map((entry, activeIdx) => {
              const key = gridColumnSortKey(entry);
              return (
                <span key={key} data-sort-key={key} className="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={withClickGuard(() => toggleGridColumn(entry))}
                    className="rounded-md border px-3 py-1.5 text-sm border-status-magenta bg-status-magenta/10 text-status-magenta cursor-grab active:cursor-grabbing"
                  >
                    ⠿ {gridColumnLabel(entry)}
                  </button>
                  <span className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={activeIdx === 0}
                      onClick={() => moveActiveColumn(entry, -1)}
                      title={t("action.move_up", "העלה")}
                      className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-gray-400 hover:text-status-magenta hover:bg-gray-50 active:bg-gray-100 disabled:opacity-20"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={activeIdx === orderedActiveColumns.length - 1}
                      onClick={() => moveActiveColumn(entry, 1)}
                      title={t("action.move_down", "הורד")}
                      className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-gray-400 hover:text-status-magenta hover:bg-gray-50 active:bg-gray-100 disabled:opacity-20"
                    >
                      ▼
                    </button>
                  </span>
                </span>
              );
            })}
            {sortedGridColumns.filter((entry) => !isGridColumnActive(entry)).map((entry) => {
              const key = gridColumnSortKey(entry);
              return (
                <button
                  key={key}
                  type="button"
                  data-sort-key={key}
                  data-sortable-disabled=""
                  onClick={() => toggleGridColumn(entry)}
                  className="rounded-md border px-3 py-1.5 text-sm border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  {gridColumnLabel(entry)}
                </button>
              );
            })}
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
        {/* fixes48 §3: column filtering — report_numbers, then one control
            per active contact_shliach picklist/custom field. Shliach-only,
            same as the geo filters above; admin/staff rows are unaffected. */}
        <MultiSelectFilter
          allLabel={t("contact_shliach.report_numbers", "מספרי דוח באחריות הפעיל")}
          options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
          value={reportNumberIds}
          onChange={(ids) => {
            setReportNumberIds(ids);
            setPage(1);
          }}
        />
        {shliachPicklistDefs.map((d) => {
          const opts = shliachPicklists.map[d.field_key] ?? [];
          return (
            <MultiSelectFilter
              key={`plf-${d.field_key}`}
              allLabel={d.label || d.field_key}
              options={opts.map((o) => ({ id: o.value, label: shliachPicklists.display(o) }))}
              value={shliachPicklistFilters[d.field_key] ?? []}
              onChange={(vals) => {
                setShliachPicklistFilters((prev) => ({ ...prev, [d.field_key]: vals }));
                setPage(1);
              }}
            />
          );
        })}
        {shliachCustomFieldDefs.map((d) =>
          d.field_type === "boolean" ? (
            <select
              key={`cff-${d.field_key}`}
              className={toolbarSelectClass}
              value={shliachFieldFilters[d.field_key] ?? ""}
              onChange={(e) => {
                setShliachFieldFilters((prev) => ({ ...prev, [d.field_key]: e.target.value }));
                setPage(1);
              }}
            >
              <option value="">{d.hebrew_label || d.field_key}</option>
              <option value="true">{t("common.yes", "כן")}</option>
              <option value="false">{t("common.no", "לא")}</option>
            </select>
          ) : (
            <input
              key={`cff-${d.field_key}`}
              className={toolbarSelectClass}
              placeholder={d.hebrew_label || d.field_key}
              value={shliachFieldFilters[d.field_key] ?? ""}
              onChange={(e) => {
                setShliachFieldFilters((prev) => ({ ...prev, [d.field_key]: e.target.value }));
                setPage(1);
              }}
            />
          ),
        )}
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
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap min-w-[150px]">
                {t("common.name", "שם")}
              </th>
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap min-w-[120px]">
                {t("users.role_label", "תפקיד")}
              </th>
              {/* fixes48 §3: fixed + custom picklist + custom field columns,
                  in the user's unified (draggable) order. fixes49 §1: each
                  column carries a data-type-dependent min-width floor so RTL
                  headers don't squeeze. */}
              {orderedActiveColumns.map((entry) => (
                <th
                  key={gridColumnSortKey(entry)}
                  className={`px-3 py-1.5 font-medium w-px whitespace-nowrap ${gridColumnMinWidth(entry)}`}
                >
                  {gridColumnLabel(entry)}
                </th>
              ))}
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap" />
              <th className="w-full" />
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  {t("users.none", "אין משתמשים.")}
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.key} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 font-medium w-px whitespace-nowrap min-w-[150px]">
                    {r.kind === "user" ? (
                      inlineNameCell(r)
                    ) : (
                      <TruncatedText text={r.full_name} />
                    )}
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
                  {/* fixes48 §3: fixed + custom picklist + custom field
                      columns, in the user's unified (draggable) order.
                      max-w+break-words (not truncate) keeps a long value
                      from blowing the row out without clipping any inline
                      editor's floating dropdown (fixes47). */}
                  {orderedActiveColumns.map((entry) => (
                    <td
                      key={gridColumnSortKey(entry)}
                      className={`px-3 py-1.5 max-w-[14rem] break-words ${gridColumnMinWidth(entry)}`}
                    >
                      {entry.kind === "col"
                        ? cell(r, entry.key)
                        : entry.kind === "pl"
                          ? inlineShliachPicklistCell(r, entry.def)
                          : inlineShliachCustomFieldCell(r, entry.def)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 w-px whitespace-nowrap">
                    {/* fixes43 §3.3: one unified "open/edit" action — a real
                        user row opens the inline form (role/email/password),
                        which itself carries a link to the linked contact when
                        one exists; a contact-only row (no login) still just
                        links straight to the contact page. */}
                    {r.kind === "user" ? (
                      // fixes47: a dedicated per-user page (was an inline
                      // popup form with no addressable URL and no history).
                      <Link
                        href={`/dashboard/users/${r.id}`}
                        className="text-sm text-status-magenta hover:underline me-3"
                      >
                        {t("action.open_edit", "פתח / עריכה ›")}
                      </Link>
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

/** fixes47: create-only now — editing an existing user (identity, role,
 *  password, coverage, history) happens on its own dedicated page
 *  (dashboard/users/{id}), the same split Contacts has between its list
 *  page and dashboard/contacts/{id}. */
function UserForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [password, setPassword] = useState("");
  const [emailValid, setEmailValid] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!emailValid) {
      setError(t("msg.invalid_email", "כתובת אימייל לא תקינה"));
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName,
          email,
          role,
          password: password || null,
        }),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <h3 className="font-medium">{t("users.add_user", "משתמש חדש")}</h3>
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
          <select
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="staff">{t("users.role_staff", "משתמש מוגבל")}</option>
            <option value="admin">{t("users.role_admin", "מנהל מערכת")}</option>
          </select>
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
