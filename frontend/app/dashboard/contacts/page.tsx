"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CustomFieldValueDisplay, CustomFieldValueInput } from "@/components/CustomFieldValueInput";
import { DatePicker } from "@/components/DatePicker";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { PicklistSelect } from "@/components/PicklistSelect";
import { SearchableSelect } from "@/components/SearchableSelect";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { VisitForm } from "@/components/VisitForm";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rowStyle } from "@/lib/colors";
import { telHref, waHref } from "@/lib/contactActions";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { visibleOwnerOptions } from "@/lib/ownerFilter";
import { usePersistentState } from "@/lib/persist";
import {
  FIXED_CONTACT_PICKLIST_KEYS,
  usePicklist,
  usePicklistsMap,
} from "@/lib/picklists";
import { useDbPreference } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import { useSortableList } from "@/lib/useSortableList";
import { PHONE_HINT, isValidPhone } from "@/lib/validation";
import {
  contactFullName,
  type AdminArea,
  type Area,
  type Building,
  type Contact,
  type ContactPage,
  type CustomFieldDefinition,
  type PicklistField,
  type UserSummary,
  type Visit,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

type SortKey = "created" | "name";

/** Optional grid columns (fixes15 §5.1); name + email + actions are always
 * shown — fixes28 §1: email is a core identity column, no longer optional
 * (a stale saved "email" selection is ignored by the COLUMN_KEYS
 * intersection, like fixes18 §3 did for "area"). */
const COLUMN_KEYS = [
  "phone",
  "owner",
  "admin_area",
  "building",
  "created",
  "status",
  "priority",
  "address",
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];

// The spec's current default layout: Name, Phone, Assigned-to (+created,
// which the page always showed until now).
const DEFAULT_COLUMNS: ColumnKey[] = ["phone", "owner", "created"];

// fixes34 §1.1: which optional columns render an inline editor — their cells
// must stop the row's navigate-onClick from swallowing the edit click.
const EDITABLE_COLUMN_KEYS = new Set<ColumnKey>(["phone", "status", "priority", "address"]);

/** The mitzvah checkbox filters (fixes17 §2.2); fixes25: the flags live on
 * visits — a contact matches through any of its visits. fixes27 §1: the org's
 * custom fields join the same dropdown, carried under a `cf:` id prefix so the
 * request can send them all as `custom_fields`. fixes39: the 5 former
 * hardcoded Mivtzoim columns are ordinary entity_type="visit" boolean custom
 * fields now, so `customDefs` (fetched below) already includes them — there
 * is no separate fixed-key list anymore. */
const CF_PREFIX = "cf:";

export default function ContactsPage() {
  const router = useRouter();
  const { t, lang } = useLocalization();
  const { user, isShliach } = useAuth();
  const { success, error: toastError } = useToast();
  // fixes30 §2a: which contact the quick add-visit modal is open for.
  const [visitFor, setVisitFor] = useState<Contact | null>(null);
  const { isFieldVisible: vis, loading: fieldsLoading } = useFieldSettings();
  // The color has no column of its own (fixes7 §8A) — it tints the whole row.
  const showColor = vis("contacts.color_tag");
  const {
    options: statusOptions,
    labelFor: statusLabel,
    display: statusDisplay,
  } = usePicklist("contact.pipeline_status");
  // fixes27 §1: torah-thought filter options come from its picklist.
  const torahPicklist = usePicklist("checklist.torah_thought");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  // fixes18 §3.5: admin areas feed the new filter + optional column.
  const [adminAreas, setAdminAreas] = useState<AdminArea[]>([]);
  // fixes18 §3.2: unique DB values feed the tzedaka-potential dropdown.
  const [tzedakaValues, setTzedakaValues] = useState<string[]>([]);
  // fixes15 §1.2: every filter/sort/page selection survives navigation.
  const [statusFilter, setStatusFilter] = usePersistentState(
    "crm.contacts.status", "",
  );
  // "" = all users. The fixes11 §2.2 default (the logged-in user) is gone:
  // with most contacts owned by one login it silently blanked the list for
  // everyone else — the reported "contacts missing" prod bug. New storage key
  // so browsers that persisted the old auto-default reset once.
  const [assignedFilter, setAssignedFilter] = usePersistentState<string>(
    "crm.contacts.assigned2", "",
  );
  const [areaIds, setAreaIds] = usePersistentState<number[]>(
    "crm.contacts.areaIds", [],
  );
  const [buildingIds, setBuildingIds] = usePersistentState<number[]>(
    "crm.contacts.buildingIds", [],
  );
  const [adminAreaIds, setAdminAreaIds] = usePersistentState<number[]>(
    "crm.contacts.adminAreaIds", [],
  );
  const [query, setQuery] = usePersistentState("crm.contacts.q", "");
  // fixes17 §2.2: per-mitzvah checkboxes (AND); fixes18 §3.2: the tzedaka
  // filter is now an exact value picked from the aggregated dropdown.
  const [mitzvotFilter, setMitzvotFilter] = usePersistentState<string[]>(
    "crm.contacts.mitzvotFields", [],
  );
  const [tzedaka, setTzedaka] = usePersistentState("crm.contacts.tzedaka", "");
  // fixes27 §1: further visit-level filters — torah thought (picklist values,
  // OR), connection-to-the-Rebbe (contains, debounced like the text search).
  const [torahFilter, setTorahFilter] = usePersistentState<string[]>(
    "crm.contacts.torahThought", [],
  );
  const [rebbeQuery, setRebbeQuery] = usePersistentState("crm.contacts.rebbe", "");
  const [debouncedRebbe, setDebouncedRebbe] = useState(rebbeQuery);
  const rebbeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // fixes27 §1: the org's custom fields feed extra מבצעים filter options.
  const [customDefs, setCustomDefs] = useState<CustomFieldDefinition[]>([]);
  // fixes34 §1.1: any admin-added contact picklist beyond the fixed set —
  // same mechanism as the apartments page's `customDefs` (fixes32 §6): each
  // one automatically gets a filter, a column and a CRUD field.
  const [customPicklistDefs, setCustomPicklistDefs] = useState<PicklistField[]>([]);
  const [customPicklistFilters, setCustomPicklistFilters] = usePersistentState<
    Record<string, string[]>
  >("crm.contacts.customPicklistFilters", {});
  // fixes34 §1.1: which custom picklists show as table columns — null (unset)
  // means "all of them", so existing users see no change until they
  // explicitly hide one via the column-selector panel (mirrors fixes33 §3.1's
  // apartments.customFields preference).
  const [visibleCustomPicklistKeys, setVisibleCustomPicklistKeys] = useDbPreference<
    string[] | null
  >("contacts.customFields", null);
  // fixes34 §1.1: field-visibility-aware custom picklists + their options.
  const orgVisibleCustomPicklistDefs = customPicklistDefs.filter((d) => vis(d.field_key));
  const customPicklists = usePicklistsMap(
    orgVisibleCustomPicklistDefs.map((d) => d.field_key),
  );
  const visibleCustomPicklistDefs = orgVisibleCustomPicklistDefs.filter(
    (d) => visibleCustomPicklistKeys == null || visibleCustomPicklistKeys.includes(d.field_key),
  );
  // fixes35 §3: any non-select mekurav custom field — same column-selector
  // treatment as the picklist ones above, in its own preference so existing
  // "contacts.customFields" selections (picklist-only) are untouched.
  const customFieldDefs = useCustomFieldDefs("contact_mekurav").filter(
    (d) => d.field_type !== "select",
  );
  const orgVisibleCustomFieldDefs = customFieldDefs.filter((d) =>
    vis(`customfield.contact_mekurav.${d.field_key}`),
  );
  const [visibleCustomFieldKeys, setVisibleCustomFieldKeys] = useDbPreference<string[] | null>(
    "contacts.customFieldFields", null,
  );
  const visibleCustomFieldDefs = orgVisibleCustomFieldDefs.filter(
    (d) => visibleCustomFieldKeys == null || visibleCustomFieldKeys.includes(d.field_key),
  );
  function toggleCustomFieldColumn(fieldKey: string) {
    setVisibleCustomFieldKeys((prev) => {
      const current = prev ?? orgVisibleCustomFieldDefs.map((d) => d.field_key);
      return current.includes(fieldKey)
        ? current.filter((k) => k !== fieldKey)
        : [...current, fieldKey];
    });
  }
  // fixes25 §4: visit date range (טווח תאריכי ביקור) — only contacts holding a
  // visit inside the range.
  const [visitFrom, setVisitFrom] = usePersistentState<string | null>(
    "crm.contacts.visitFrom", null,
  );
  const [visitTo, setVisitTo] = usePersistentState<string | null>(
    "crm.contacts.visitTo", null,
  );
  const [sort, setSort] = usePersistentState<SortKey>(
    "crm.contacts.sort", "created", // fixes11 §2.3 default
  );
  const [dir, setDir] = usePersistentState<"asc" | "desc">(
    "crm.contacts.dir", "desc",
  );
  const [page, setPage] = usePersistentState("crm.contacts.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.contacts.pageSize", 20);
  // fixes29 §1: the whole filter section can be tucked away (visibility only —
  // hidden filters keep applying to the list).
  const [filtersOpen, setFiltersOpen] = usePersistentState(
    "crm.contacts.filtersOpen",
    true,
  );
  // fixes17 §1.1: the column selection lives in the DB — follows the account
  // across browsers/devices (localStorage is only the boot cache).
  const [columns, setColumns] = useDbPreference<ColumnKey[]>(
    "contacts.columns", DEFAULT_COLUMNS,
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  // fixes39: SortableJS-backed reorder, mobile-first (native HTML5
  // drag-and-drop never engages on many Windows trackpads — see
  // useSortableList's doc comment).
  const { containerRef: columnsSortableRef, withClickGuard } =
    useSortableList<HTMLDivElement>(reorderColumns);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Debounce the text filter; the `debouncedQ` value hits the server.
  const [debouncedQ, setDebouncedQ] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Users directory feeds the owner column + filter (admin/staff only); the
  // admin-areas directory feeds the new filter (blocked for shliach, fixes10).
  useEffect(() => {
    if (isShliach || !user) return;
    apiFetch<UserSummary[]>("/api/users").then(setUsers).catch(() => {});
    apiFetch<AdminArea[]>("/api/admin-areas").then(setAdminAreas).catch(() => {});
  }, [isShliach, user]);

  // fixes18 §3.2: aggregate the org's existing tzedaka-potential values.
  useEffect(() => {
    if (!user) return;
    apiFetch<string[]>("/api/contacts/tzedaka-values")
      .then(setTzedakaValues)
      .catch(() => {});
  }, [user]);

  // Areas + buildings feed the geographic multi-select filters (fixes15 §5.1);
  // fixes27 §1: the active custom-field definitions feed the מבצעים dropdown.
  useEffect(() => {
    if (!user) return;
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => {});
    apiFetch<Building[]>("/api/buildings").then(setBuildings).catch(() => {});
    // fixes35: /api/custom-fields now spans every entity_type — this
    // dropdown is specifically the visit-level boolean checklist filter
    // (mirrors the backend's own entity_type=visit/field_type=boolean scope).
    apiFetch<CustomFieldDefinition[]>("/api/custom-fields?entity_type=visit")
      .then((defs) => setCustomDefs(defs.filter((d) => d.field_type === "boolean")))
      .catch(() => {});
    // fixes34 §1.1 / fixes37: any admin-added contact picklist — entity_type
    // is real data now, not a prefix guess (excludes the fixed contact ones
    // plus every other entity's picklists, which belong to their own tabs).
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) =>
        setCustomPicklistDefs(
          defs.filter(
            (d) =>
              d.entity_type === "contact_mekurav" &&
              !FIXED_CONTACT_PICKLIST_KEYS.includes(d.field_key),
          ),
        ),
      )
      .catch(() => setCustomPicklistDefs([]));
  }, [user]);

  // fixes17 §5.1: the persisted filter survives ACROSS logins on a shared
  // browser — a shliach inheriting an admin's guid saw an empty list. A
  // shliach never applies an owner filter (server-scoped anyway).
  useEffect(() => {
    if (!user) return;
    if (isShliach && assignedFilter !== "") setAssignedFilter("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedFilter, user, isShliach]);

  // fixes40 §2: when "Activists may view contacts" is off, shliach-role
  // users drop out of the owner-filter options entirely (they're not valid
  // "contact owners" to filter by in that mode).
  const activistsMayViewContacts = user?.organization?.shliach_can_view_contacts ?? false;
  const ownerOptions = visibleOwnerOptions(users, activistsMayViewContacts);

  // fixes17 §5.1 (admin/staff): a persisted owner guid that no longer matches
  // anyone in the org (other login, deleted/recreated user) — or that fell
  // out of `ownerOptions` because the org just turned the permission off
  // (fixes40 §2) — resets to "all users". Resetting to the current user
  // re-created the invisible-subset trap this round removed.
  useEffect(() => {
    if (isShliach || !user || users.length === 0) return;
    if (assignedFilter && !ownerOptions.some((u) => u.guid === assignedFilter)) {
      setAssignedFilter("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerOptions, assignedFilter, user, isShliach]);

  const ownerName = (guid: string | null) =>
    (guid && users.find((u) => u.guid === guid)?.full_name) || "—";

  function onQueryChange(v: string) {
    setQuery(v);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(v), 300);
  }

  // fixes28 §3: the filter strictly obeys the hidden state — a persisted
  // selection of a since-deactivated field must neither render in the
  // dropdown/chip count nor keep filtering the list. The effective
  // selection is the persisted one intersected with the visible options.
  // fixes39: `customDefs` (active entity_type="visit" boolean custom
  // fields) already includes the 5 former Mivtzoim columns once seeded —
  // no separate fixed-key list to union in anymore.
  const visibleMitzvahIds = new Set<string>(
    customDefs.map((d) => `${CF_PREFIX}${d.field_key}`),
  );
  const effectiveMitzvot = mitzvotFilter.filter((m) => visibleMitzvahIds.has(m));
  const effectiveTorah = vis("visits.torah_thought") ? torahFilter : [];
  // fixes39: connection_to_rebbe is a custom field now, not a field_settings
  // toggle — always shown (same as any other text-search filter).
  const effectiveRebbe = debouncedRebbe;
  // Same rule for the two filters whose CONTROLS can be absent: a pipeline
  // status the org hid, and admin areas for a shliach, must not keep
  // filtering from persisted state the user can no longer see or clear.
  const effectiveStatus = vis("contacts.pipeline_status") ? statusFilter : "";
  const effectiveAdminAreaIds = isShliach ? [] : adminAreaIds;
  // fixes34 §1.1: a custom picklist filter selection is dropped once its
  // definition is hidden org-wide (mirrors the effective* pattern above).
  const visibleCustomPicklistKeySet = new Set(
    orgVisibleCustomPicklistDefs.map((d) => d.field_key),
  );
  const effectiveCustomPicklistFilters = Object.fromEntries(
    Object.entries(customPicklistFilters).filter(([k]) => visibleCustomPicklistKeySet.has(k)),
  );

  // The list can be narrowed while the controls are collapsed (fixes29 §1) —
  // count the active criteria so the toggle button and the empty state can
  // say so instead of silently showing a subset.
  const activeFilterCount =
    (query.trim() ? 1 : 0) +
    areaIds.length +
    buildingIds.length +
    effectiveAdminAreaIds.length +
    effectiveMitzvot.length +
    (tzedaka.trim() ? 1 : 0) +
    effectiveTorah.length +
    (effectiveRebbe.trim() ? 1 : 0) +
    (visitFrom || visitTo ? 1 : 0) +
    (effectiveStatus ? 1 : 0) +
    (assignedFilter ? 1 : 0) +
    Object.values(effectiveCustomPicklistFilters).reduce((n, v) => n + v.length, 0);

  function clearAllFilters() {
    setQuery("");
    setDebouncedQ("");
    setAreaIds([]);
    setBuildingIds([]);
    setAdminAreaIds([]);
    setMitzvotFilter([]);
    setCustomPicklistFilters({});
    setTzedaka("");
    setTorahFilter([]);
    setRebbeQuery("");
    setDebouncedRebbe("");
    setVisitFrom(null);
    setVisitTo(null);
    setStatusFilter("");
    setAssignedFilter(""); // "" = all users (null would re-default to self)
    setPage(1);
  }

  function listParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("contact_type", "mekurav"); // contacts page shows mekuravim only
    if (effectiveStatus) params.set("pipeline_status", effectiveStatus);
    if (assignedFilter) params.set("assigned_user_id", assignedFilter);
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    areaIds.forEach((id) => params.append("area_ids", String(id)));
    buildingIds.forEach((id) => params.append("building_ids", String(id)));
    // fixes18 §3.5: admin-area filter.
    effectiveAdminAreaIds.forEach((id) => params.append("admin_area_ids", String(id)));
    // fixes17 §2.2: individual mitzvah checkboxes (fixes39: every option is
    // an entity_type="visit" boolean custom field, sent as `custom_fields`).
    // fixes18 §3.2: the tzedaka value is an exact selection from the
    // aggregated dropdown. fixes28 §3: only the *effective* (still-visible)
    // selections are sent.
    effectiveMitzvot.forEach((m) =>
      params.append("custom_fields", m.slice(CF_PREFIX.length)),
    );
    if (tzedaka.trim()) {
      params.set("tzedaka_potential", tzedaka.trim());
    }
    // fixes27 §1: torah thought (OR list) + connection-to-the-Rebbe contains.
    effectiveTorah.forEach((v) => params.append("torah_thought", v));
    if (effectiveRebbe.trim()) {
      params.set("connection_to_rebbe", effectiveRebbe.trim());
    }
    // fixes25 §4: visit date range.
    if (visitFrom) params.set("visit_from", visitFrom);
    if (visitTo) params.set("visit_to", visitTo);
    // fixes34 §1.1: dynamic contact-picklist filters, "field_key:value" pairs
    // (OR within a field_key, AND across) — mirrors the apartments page.
    for (const [fieldKey, values] of Object.entries(effectiveCustomPicklistFilters)) {
      values.forEach((v) => params.append("picklist", `${fieldKey}:${v}`));
    }
    return params;
  }

  // Server-side page (fixes8 §2C pattern) instead of the full org dump.
  // Waits for the field settings too — the effective* pruning above is
  // meaningless before they load, and firing early sends a request whose
  // late response can overwrite the corrected one.
  const fetchSeq = useRef(0);
  useEffect(() => {
    if (!user || fieldsLoading) return; // session/visibility not resolved yet
    const seq = ++fetchSeq.current;
    const params = listParams();
    params.set("sort", sort);
    params.set("dir", dir);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    setLoading(true);
    apiFetch<ContactPage>(`/api/contacts/list?${params}`)
      .then((res) => {
        if (seq !== fetchSeq.current) return; // a newer request superseded us
        setContacts(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        if (seq !== fetchSeq.current) return;
        setContacts([]);
        setTotal(0);
      })
      .finally(() => {
        if (seq === fetchSeq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user, fieldsLoading, effectiveStatus, assignedFilter, debouncedQ,
    areaIds, buildingIds,
    // fixes28 §3: the effective (visibility-pruned) selections drive the
    // fetch; joined because they are re-derived arrays, not state.
    effectiveAdminAreaIds.join(","), effectiveMitzvot.join(","), tzedaka,
    effectiveTorah.join(","), effectiveRebbe,
    visitFrom, visitTo, sort, dir, page, pageSize,
    // fixes34 §1.1: custom picklist filter selections.
    JSON.stringify(effectiveCustomPicklistFilters),
  ]);

  // fixes15 §5.2: mass email to the WHOLE filtered set via mailto: BCC.
  async function bulkEmail() {
    try {
      const emails = await apiFetch<string[]>(
        `/api/contacts/emails?${listParams()}`,
      );
      if (emails.length === 0) {
        toastError(t("msg.no_emails_in_list", "אין כתובות אימייל ברשימה המסוננת."));
        return;
      }
      window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(","))}`;
    } catch {
      toastError(t("msg.no_emails_in_list", "אין כתובות אימייל ברשימה המסוננת."));
    }
  }

  // Column availability = org-level field settings; the user's selection
  // (localStorage) picks among the available ones. Owner is meaningless for
  // a shliach (everything is theirs).
  const availability: Record<ColumnKey, boolean> = {
    // fixes34 §3.1: phone is now toggleable like the other optional columns.
    phone: vis("contacts.phone"),
    owner: !isShliach,
    // fixes18 §3.4: the admin-areas section is blocked for shliach (fixes10).
    admin_area: !isShliach && vis("contact_mekurav.admin_area_id"),
    building: true,
    // fixes38b: this was hardcoded true, ignoring the contacts.created_at
    // toggle entirely — hiding "Created On" in Manage Fields only ever
    // affected the contact detail page's row, never this grid column.
    created: vis("contacts.created_at"),
    status: vis("contacts.pipeline_status"),
    priority: vis("contacts.priority_score"),
    address: vis("contacts.address"),
  };
  const columnLabels: Record<ColumnKey, string> = {
    phone: t("contacts.phone", "טלפון"),
    owner: t("contacts.assigned_user_id", "משויך ל"),
    admin_area: t("contact_mekurav.admin_area_id", "אזור מנהל"),
    building: t("contacts.building", "בניין"),
    created: t("contacts.created_at", "נוצר בתאריך"),
    status: t("contacts.pipeline_status", "סטטוס"),
    priority: t("contacts.priority_score", "ציון עדיפות"),
    address: t("contacts.address", "כתובת"),
  };
  // fixes38 §1.1: iterate `columns` (the ordered preference), not the fixed
  // COLUMN_KEYS array — otherwise a user's chosen order is stored but never
  // rendered, which reads as "drag-and-drop reordering doesn't work".
  const activeColumns = columns.filter(
    (k): k is ColumnKey => (COLUMN_KEYS as readonly string[]).includes(k) && availability[k],
  );
  // name + actions + quick actions + the trailing filler column.
  const colCount =
    4 + activeColumns.length + visibleCustomPicklistDefs.length + visibleCustomFieldDefs.length;

  function toggleColumn(k: ColumnKey) {
    setColumns((prev) =>
      prev.includes(k) ? prev.filter((c) => c !== k) : [...prev, k],
    );
  }

  // fixes39 §3: SortableJS's container holds every chip (active + inactive
  // — an inactive one can't be dragged, per useSortableList's `filter`, but
  // a dragged active chip can still land next to/among them), so rather
  // than translate a single from/to index pair against two different lists,
  // just recompute the active order from the container's resulting DOM
  // order directly: keep whichever of `orderedKeys` are currently "on", in
  // their new relative order.
  function reorderColumns(orderedKeys: string[]) {
    setColumns((prev) => {
      const activeSet = new Set(
        prev.filter((k): k is ColumnKey => (COLUMN_KEYS as readonly string[]).includes(k)),
      );
      const reordered = orderedKeys.filter((k): k is ColumnKey => activeSet.has(k as ColumnKey));
      return reordered.length > 0 ? reordered : prev;
    });
  }

  // fixes38: guaranteed-reliable fallback for the pointer/drag reorder above
  // — a trackpad's drag gesture is ultimately at the mercy of the OS/driver
  // ever reporting a sustained press-and-move, which nothing in-app can force
  // 100% of the time. These buttons swap adjacent active columns directly,
  // the same one-step arrow-button pattern the contact page's own Display
  // Order settings already use (moveSegment) — no gesture involved at all.
  function moveActiveColumn(key: ColumnKey, delta: -1 | 1) {
    setColumns((prev) => {
      const known = prev.filter((k): k is ColumnKey =>
        (COLUMN_KEYS as readonly string[]).includes(k),
      );
      const idx = known.indexOf(key);
      const to = idx + delta;
      if (idx === -1 || to < 0 || to >= known.length) return prev;
      const next = [...known];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  }

  // fixes34 §1.1: one-field inline save straight from the list row — contacts
  // aren't versioned (unlike apartments), so a plain PATCH suffices; merge
  // the response back into the row in place so scroll/filters/page stay put.
  async function saveField(c: Contact, body: Record<string, unknown>) {
    const saved = await apiFetch<Contact>(`/api/contacts/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setContacts((prev) => prev.map((it) => (it.id === c.id ? { ...it, ...saved } : it)));
  }

  const inlineTextCell = (
    c: Contact,
    field: "phone" | "address",
    opts: { dir?: "ltr"; validate?: (v: string) => string | null } = {},
  ) => (
    <InlineEdit<string>
      value={(c[field] as string | null) ?? ""}
      display={c[field] ? <span dir={opts.dir}>{c[field] as string}</span> : "—"}
      validate={opts.validate}
      onSave={(v) => saveField(c, { [field]: v.trim() || null })}
      editor={(draft, setDraft) => (
        <input
          className={inputClass}
          dir={opts.dir}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
    />
  );

  const inlinePriorityCell = (c: Contact) => (
    <InlineEdit<string>
      value={c.priority_score != null ? String(c.priority_score) : ""}
      display={c.priority_score ?? "—"}
      onSave={(v) =>
        saveField(c, { priority_score: v.trim() === "" ? null : Number(v.trim()) })
      }
      editor={(draft, setDraft) => (
        <input
          type="number"
          className={inputClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
    />
  );

  const inlineStatusCell = (c: Contact) => (
    <InlineEdit<string | null>
      value={c.pipeline_status ?? null}
      display={statusLabel(c.pipeline_status) || "—"}
      commitOnBlur={false}
      onSave={(v) => saveField(c, { pipeline_status: v })}
      editor={(draft, _setDraft, commit) => (
        <PicklistSelect
          fieldKey="contact.pipeline_status"
          value={draft}
          onChange={commit}
        />
      )}
    />
  );

  // fixes34 §1.1: same InlineEdit + PicklistSelect pattern for any admin-added
  // custom contact picklist column.
  const inlineCustomPicklistCell = (c: Contact, d: PicklistField) => (
    <InlineEdit<string | null>
      value={c.picklist_values?.[d.field_key] ?? null}
      display={customPicklists.labelFor(d.field_key, c.picklist_values?.[d.field_key]) || "—"}
      commitOnBlur={false}
      onSave={(v) => saveField(c, { picklist_values: { [d.field_key]: v } })}
      editor={(draft, _setDraft, commit) => (
        <PicklistSelect fieldKey={d.field_key} value={draft} onChange={commit} />
      )}
    />
  );

  // fixes35 §3: same InlineEdit pattern for any non-select mekurav custom field.
  const inlineCustomFieldCell = (c: Contact, d: CustomFieldDefinition) => {
    const value = c.custom_field_values?.[d.field_key] ?? null;
    return (
      <InlineEdit<string | number | boolean | null>
        value={value}
        display={<CustomFieldValueDisplay fieldType={d.field_type} value={value} />}
        commitOnBlur={d.field_type === "text" || d.field_type === "number"}
        onSave={(v) => saveField(c, { custom_field_values: { [d.field_key]: v } })}
        editor={(draft, setDraft, commit) => (
          <CustomFieldValueInput
            fieldType={d.field_type}
            value={draft}
            onChange={
              d.field_type === "boolean" || d.field_type === "date" ? commit : setDraft
            }
          />
        )}
      />
    );
  };

  function cell(c: Contact, k: ColumnKey) {
    switch (k) {
      case "phone":
        return inlineTextCell(c, "phone", {
          dir: "ltr",
          validate: (v) =>
            v.trim() === "" || isValidPhone(v.trim())
              ? null
              : t("validation.phone_hint", PHONE_HINT),
        });
      case "owner":
        return ownerName(c.assigned_user_id);
      case "admin_area":
        return c.admin_area_name ?? "—";
      case "building":
        return c.building_name ?? "—";
      case "created":
        return (
          <span dir="ltr">{new Date(c.created_at).toLocaleDateString("he-IL")}</span>
        );
      case "status":
        return inlineStatusCell(c);
      case "priority":
        return inlinePriorityCell(c);
      case "address":
        return inlineTextCell(c, "address");
    }
  }

  const buildingOptions = buildings
    .filter((b) => areaIds.length === 0 || (b.area_id != null && areaIds.includes(b.area_id)))
    .map((b) => ({
      id: b.id,
      label:
        (b.building_address ?? "").split(",")[0].trim() ||
        b.building_name ||
        `#${b.id}`,
    }));

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(total === 0 ? 0 : (page - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(page * pageSize, total)))
    .replace("{total}", String(total));

  const selectClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("contacts", "אנשי קשר")}</h1>
        <div className="flex items-center gap-2">
          {/* Always reachable while any filter narrows the list — a saved
              filter must never require hunting through the controls to undo
              (the empty-state button below only covers the zero-results case). */}
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="rounded-md border border-gray-300 text-gray-600 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              ✕ {t("filter.clear_all", "נקה את כל הסינונים")}
            </button>
          )}
          {/* fixes29 §1: show/hide the whole filter block below. */}
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="rounded-md border border-gray-300 text-gray-600 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            {filtersOpen
              ? `▴ ${t("filter.hide_filters", "הסתר סינון")}`
              : `▾ ${t("filter.show_filters", "הצג סינון")}`}
            {/* Collapsed filters keep applying — surface how many are active. */}
            {!filtersOpen && activeFilterCount > 0 && (
              <span className="ms-1.5 inline-flex items-center justify-center rounded-full bg-status-magenta text-white text-xs px-1.5 py-0.5 leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>
          {/* fixes38 §1.1: the columns toggle lives outside the filtersOpen
              block so collapsing filters never hides it. */}
          <button
            type="button"
            onClick={() => setColumnsOpen((v) => !v)}
            className="rounded-md border border-gray-300 text-gray-600 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            ⚙ {t("columns.configure", "התאמת עמודות")}
          </button>
          <button
            type="button"
            onClick={bulkEmail}
            className="rounded-md border border-status-magenta text-status-magenta px-4 py-2 text-sm font-medium hover:bg-status-magenta/10"
          >
            ✉ {t("action.bulk_email", "מייל לכל התוצאות")}
          </button>
          {/* fixes10 §3.3: shliach users create (their own) contacts too. */}
          <Link
            href="/dashboard/contacts/new"
            className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            + {t("page.new_contact", "איש קשר חדש")}
          </Link>
        </div>
      </div>

      {/* fixes15 §5.1: user-selected grid columns (persisted per browser).
          fixes38 §1.1: deliberately OUTSIDE the filtersOpen fragment below,
          so collapsing filters never hides it. */}
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
            {t(
              "columns.hint",
              "בחר אילו עמודות יוצגו בטבלה. ההעדפה נשמרת בדפדפן זה.",
            )}
          </p>
          <p className="text-xs text-gray-400">
            {t("columns.reorder_hint", "גרור עמודה פעילה כדי לשנות את סדר ההצגה.")}
          </p>
          {/* fixes39 §3: one real SortableJS-managed container for every
              chip, active or not (mobile-first — see useSortableList's doc
              comment). An inactive chip is marked `data-sortable-disabled`
              so it can't itself be dragged (its plain toggle-on click still
              works — `preventOnFilter: false`), but still occupies a normal
              slot so active ones keep flowing in the same row. Active chips
              render FIRST, in their actual current (reordered) order, so a
              successful drag is immediately visible here, not just in the
              table. */}
          <div ref={columnsSortableRef} className="flex flex-wrap gap-2">
            {activeColumns.filter((k) => availability[k]).map((k) => {
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
                  {/* fixes38: guaranteed-reliable fallback for dragging —
                      a click always works, unlike a drag gesture on some
                      trackpads. */}
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
            {COLUMN_KEYS.filter((k) => !activeColumns.includes(k) && availability[k]).map(
              (k) => (
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
              ),
            )}
            {/* fixes34 §1.1: one toggle chip per admin-added contact
                picklist — same "contacts.customFields" preference the
                filter/column rendering below consults. */}
            {orgVisibleCustomPicklistDefs.map((d) => {
              const on =
                visibleCustomPicklistKeys == null ||
                visibleCustomPicklistKeys.includes(d.field_key);
              return (
                <button
                  key={d.field_key}
                  type="button"
                  data-sortable-disabled=""
                  onClick={() =>
                    setVisibleCustomPicklistKeys((prev) => {
                      const current =
                        prev ?? orgVisibleCustomPicklistDefs.map((cd) => cd.field_key);
                      return current.includes(d.field_key)
                        ? current.filter((k) => k !== d.field_key)
                        : [...current, d.field_key];
                    })
                  }
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    on
                      ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {(lang === "en" ? d.english_label || d.label : d.label) || d.field_key}
                </button>
              );
            })}
            {/* fixes35 §3: one toggle chip per non-select mekurav custom field. */}
            {orgVisibleCustomFieldDefs.map((d) => {
              const on =
                visibleCustomFieldKeys == null || visibleCustomFieldKeys.includes(d.field_key);
              return (
                <button
                  key={d.field_key}
                  type="button"
                  data-sortable-disabled=""
                  onClick={() => toggleCustomFieldColumn(d.field_key)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    on
                      ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {(lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                    d.field_key}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* fixes15 §5.1: apartments-style filters — geo multi-selects + search.
          fixes29 §1: both filter rows unmount while the header toggle is off;
          the persisted filter state is untouched, so they keep filtering the
          list. */}
      {filtersOpen && (<>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <MultiSelectFilter
          allLabel={t("filter.all_areas", "כל האזורים")}
          options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
          value={areaIds}
          onChange={(ids) => {
            setAreaIds(ids);
            // Drop building selections that fall outside the chosen areas.
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
        {/* fixes18 §3.5: admin-area filter (admin/staff — blocked for shliach). */}
        {!isShliach && (
          <MultiSelectFilter
            allLabel={t("filter.all_admin_areas", "כל אזורי המנהל")}
            options={adminAreas.map((a) => ({ id: a.id, label: a.name }))}
            value={adminAreaIds}
            onChange={(ids) => {
              setAdminAreaIds(ids);
              setPage(1);
            }}
          />
        )}
        {/* fixes34 §1.1: one filter per admin-added contact picklist (an
            org-hidden one is excluded via orgVisibleCustomPicklistDefs). */}
        {orgVisibleCustomPicklistDefs.map((d) => {
          const opts = customPicklists.map[d.field_key] ?? [];
          return (
            <MultiSelectFilter
              key={d.field_key}
              allLabel={(lang === "en" ? d.english_label || d.label : d.label) || d.field_key}
              options={opts.map((o) => ({ id: o.value, label: customPicklists.display(o) }))}
              value={customPicklistFilters[d.field_key] ?? []}
              onChange={(vals) => {
                setCustomPicklistFilters((prev) => ({ ...prev, [d.field_key]: vals }));
                setPage(1);
              }}
            />
          );
        })}
        <input
          className={`${selectClass} flex-1 min-w-[12rem]`}
          placeholder={t("filter.search_contacts", "חיפוש לפי שם, טלפון או אימייל…")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {/* fixes17 §2.2: one checkbox per mitzvah (fixes25: visit-level
            flags; fixes39: every option — migrated or admin-added — is an
            active entity_type="visit" boolean custom field, so deactivated
            ones already drop out of `customDefs` server-side). */}
        <MultiSelectFilter
          allLabel={t("filter.all_mitzvot", "מבצעים")}
          options={customDefs.map((d) => ({
            id: `${CF_PREFIX}${d.field_key}`,
            label: d.hebrew_label,
          }))}
          value={effectiveMitzvot}
          onChange={(ids) => {
            setMitzvotFilter(ids);
            setPage(1);
          }}
        />
        {/* fixes27 §1: torah-thought filter (any visit carries the value). */}
        {vis("visits.torah_thought") && (
          <MultiSelectFilter
            allLabel={t("filter.all_torah_thoughts", "דבר תורה")}
            options={torahPicklist.options.map((o) => ({
              id: o.value,
              label: torahPicklist.display(o),
            }))}
            value={effectiveTorah}
            onChange={(ids) => {
              setTorahFilter(ids);
              setPage(1);
            }}
          />
        )}
        {/* fixes27 §1: connection-to-the-Rebbe contains-filter. */}
        {vis("visits.connection_to_rebbe") && (
          <input
            className={`${selectClass} w-44`}
            placeholder={t("filter.rebbe_ph", "קשר לרבי…")}
            value={rebbeQuery}
            onChange={(e) => {
              setRebbeQuery(e.target.value);
              setPage(1);
              if (rebbeDebounceRef.current) clearTimeout(rebbeDebounceRef.current);
              rebbeDebounceRef.current = setTimeout(
                () => setDebouncedRebbe(e.target.value),
                300,
              );
            }}
          />
        )}
        {/* fixes18 §3.2: tzedaka-potential dropdown over the org's values. */}
        <SearchableSelect
          className="w-44"
          value={tzedaka === "" ? null : tzedaka}
          onChange={(v) => {
            setTzedaka(v ?? "");
            setPage(1);
          }}
          options={[...new Set([...tzedakaValues, ...(tzedaka ? [tzedaka] : [])])].map(
            (v) => ({ id: v, label: v }),
          )}
          placeholder={t("filter.tzedaka_ph", "פוטנציאל לצדקה…")}
          emptyLabel={t("filter.all_tzedaka", "כל פוטנציאל לצדקה")}
        />
        {/* fixes25 §4: visit date-range filter (טווח תאריכי ביקור). */}
        <span className="flex items-center gap-2">
          <span className="text-gray-500">{t("visits.date_range", "טווח תאריכי ביקור")}:</span>
          <DatePicker
            value={visitFrom}
            onChange={(v) => {
              setVisitFrom(v);
              setPage(1);
            }}
            className={`${selectClass} w-36`}
            placeholder={t("visits.date_from", "מתאריך")}
          />
          <DatePicker
            value={visitTo}
            onChange={(v) => {
              setVisitTo(v);
              setPage(1);
            }}
            className={`${selectClass} w-36`}
            placeholder={t("visits.date_to", "עד תאריך")}
          />
          {/* fixes28 §1: one-click reset of the visit date range. */}
          {(visitFrom || visitTo) && (
            <button
              type="button"
              onClick={() => {
                setVisitFrom(null);
                setVisitTo(null);
                setPage(1);
              }}
              className="text-status-magenta hover:underline"
            >
              ✕ {t("action.clear", "נקה")}
            </button>
          )}
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        {availability.status && (
          <select
            className={selectClass}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("filter.all_statuses", "כל הסטטוסים")}</option>
            {statusOptions.map((o) => (
              <option key={o.id} value={o.value}>
                {statusDisplay(o)}
              </option>
            ))}
          </select>
        )}
        {/* fixes11 §2.2: owner filter, defaulting to the logged-in user.
            fixes40 §2: searchable, and restricted to admin/staff options
            when activists may not view contacts. */}
        {!isShliach && ownerOptions.length > 0 && (
          <span className="flex items-center gap-2 text-sm text-gray-500">
            {t("filter.by_assigned", "משויך ל:")}
            <SearchableSelect
              className="w-48"
              value={assignedFilter || null}
              onChange={(guid) => {
                setAssignedFilter(guid ?? "");
                setPage(1);
              }}
              options={ownerOptions.map((u) => ({ id: u.guid, label: u.full_name }))}
              placeholder={t("filter.all_users", "כל המשתמשים")}
              emptyLabel={t("filter.all_users", "כל המשתמשים")}
            />
          </span>
        )}
        {/* fixes11 §2.3: sorting — default is creation date, newest first. */}
        <span className="flex items-center gap-2 text-sm text-gray-500">
          {t("sort.label", "מיון:")}
          <select
            className={selectClass}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(1);
            }}
          >
            <option value="created">{t("sort.created", "תאריך יצירה")}</option>
            <option value="name">{t("sort.by_name", "שם")}</option>
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
        <span className="ms-auto flex items-center gap-2 text-sm text-gray-500">
          {t("pager.page_size", "בעמוד:")}
          <select
            className={selectClass}
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

      </>)}

      {/* fixes30 §2a: quick visit modal — the shared VisitForm pinned to the
          row's contact, saving through the per-contact endpoint (open to any
          org member, same as the contact page's visit section). */}
      {visitFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <div>
              <h2 className="text-lg font-bold">{t("page.add_visit", "ביקור חדש")}</h2>
              <p className="text-sm text-gray-500">{contactFullName(visitFor)}</p>
            </div>
            <VisitForm
              contacts={[]}
              lockedContactId={visitFor.id}
              onCancel={() => setVisitFor(null)}
              onSave={(payload) =>
                apiFetch<Visit>(`/api/contacts/${visitFor.id}/visits`, {
                  method: "POST",
                  body: JSON.stringify(payload),
                })
              }
              onDone={() => {
                setVisitFor(null);
                success(t("msg.saved", "נשמר בהצלחה"));
              }}
            />
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          {/* Data columns are content-width (w-px + nowrap); the empty trailing
              column absorbs the slack so everything condenses to the start. */}
          <thead className="bg-gray-50 text-gray-600 text-right">
            <tr>
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                {t("common.name", "שם")}
              </th>
              {activeColumns.map((k) => (
                <th key={k} className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {columnLabels[k]}
                </th>
              ))}
              {/* fixes34 §1.1: one column per admin-added contact picklist
                  the column-selector panel has left switched on. */}
              {visibleCustomPicklistDefs.map((d) => (
                <th key={d.field_key} className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {(lang === "en" ? d.english_label || d.label : d.label) || d.field_key}
                </th>
              ))}
              {/* fixes35 §3: one column per non-select mekurav custom field
                  the column-selector panel has left switched on. */}
              {visibleCustomFieldDefs.map((d) => (
                <th key={d.field_key} className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {(lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                    d.field_key}
                </th>
              ))}
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap"></th>
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap"></th>
              <th className="w-full"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  {/* An empty page with active filters is almost never "no
                      data" — say which, and offer a one-click way out. */}
                  {activeFilterCount > 0 ? (
                    <>
                      {t(
                        "page.no_contacts_filtered",
                        "לא נמצאו אנשי קשר התואמים לסינון הפעיל.",
                      )}{" "}
                      <button
                        type="button"
                        onClick={clearAllFilters}
                        className="text-status-magenta hover:underline"
                      >
                        {t("filter.clear_all", "נקה את כל הסינונים")}
                      </button>
                    </>
                  ) : (
                    t("page.no_contacts", "אין אנשי קשר עדיין.")
                  )}
                </td>
              </tr>
            ) : (
              contacts.map((c) => (
                <tr
                  key={c.id}
                  style={showColor ? rowStyle(c.color_tag) : undefined}
                  onClick={() => router.push(`/dashboard/contacts/${c.id}`)}
                  className="border-t border-gray-100 cursor-pointer hover:bg-gray-50/80"
                >
                  <td
                    className="px-3 py-1.5 font-medium max-w-[11rem] truncate"
                    title={contactFullName(c)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ContactNameCell
                      c={c}
                      onSave={(v) => saveField(c, { name: v })}
                    />
                  </td>
                  {activeColumns.map((k) => (
                    <td
                      key={k}
                      className="px-3 py-1.5 w-px whitespace-nowrap"
                      // fixes34 §1.1: only the inline-editable columns need to
                      // stop the row's navigate-onClick — read-only columns
                      // (owner/building/created/admin_area) keep the existing
                      // "click anywhere in the row to open" behavior.
                      onClick={
                        EDITABLE_COLUMN_KEYS.has(k) ? (e) => e.stopPropagation() : undefined
                      }
                    >
                      {cell(c, k)}
                    </td>
                  ))}
                  {/* fixes34 §1.1: custom picklist columns. */}
                  {visibleCustomPicklistDefs.map((d) => (
                    <td
                      key={d.field_key}
                      className="px-3 py-1.5 w-px whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {inlineCustomPicklistCell(c, d)}
                    </td>
                  ))}
                  {/* fixes35 §3: non-select custom field columns. */}
                  {visibleCustomFieldDefs.map((d) => (
                    <td
                      key={d.field_key}
                      className="px-3 py-1.5 w-px whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {inlineCustomFieldCell(c, d)}
                    </td>
                  ))}
                  {/* fixes15 §5.2: single-click call / WhatsApp / email.
                      fixes38 §3.1: each icon now has its own Manage Fields toggle. */}
                  <td className="px-3 py-1.5 w-px whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {c.phone && vis("contacts.action_call") && (
                        <a
                          href={telHref(c.phone)}
                          onClick={(e) => e.stopPropagation()}
                          title={t("action.call", "חיוג")}
                          className="rounded-full border border-gray-200 p-1.5 leading-none hover:bg-status-green/10"
                        >
                          📞
                        </a>
                      )}
                      {c.phone && vis("contacts.action_whatsapp") && (
                        <a
                          href={waHref(c.phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={t("action.whatsapp", "וואטסאפ")}
                          className="rounded-full border border-gray-200 p-1.5 leading-none hover:bg-status-green/10"
                        >
                          💬
                        </a>
                      )}
                      {c.email && vis("contacts.action_email") && (
                        <a
                          href={`mailto:${c.email}`}
                          onClick={(e) => e.stopPropagation()}
                          title={t("action.send_email", "שליחת מייל")}
                          className="rounded-full border border-gray-200 p-1.5 leading-none hover:bg-status-magenta/10"
                        >
                          ✉
                        </a>
                      )}
                      {/* fixes30 §2a: log a visit without leaving the list. */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setVisitFor(c);
                        }}
                        title={t("visit.add", "הוסף ביקור")}
                        className="rounded-full border border-gray-200 p-1.5 leading-none hover:bg-status-green/10"
                      >
                        📅
                      </button>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 w-px whitespace-nowrap">
                    <Link
                      href={`/dashboard/contacts/${c.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm text-status-magenta hover:underline whitespace-nowrap"
                    >
                      {t("action.open_edit", "פתח / עריכה ›")}
                    </Link>
                  </td>
                  <td></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Server-side pager (fixes8 §2C pattern). */}
      {!loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-gray-500">{rangeText}</span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.next", "הבא ←")}
          </button>
        </div>
      )}
    </div>
  );
}

/** fixes34 §1.1: the name cell stays the primary navigation target (unchanged
 *  click behavior) with a separate hover-pencil icon that opens inline edit of
 *  the primary `name` field in place — mirrors ApartmentNameCell (apartments
 *  page, fixes32 §6). `last_name` keeps editing only on the full detail page. */
function ContactNameCell({
  c,
  onSave,
}: {
  c: Contact;
  onSave: (v: string | null) => Promise<void>;
}) {
  const { t } = useLocalization();
  const { error: toastError } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.name ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    if (saving) return;
    const next = draft.trim() || null;
    if (next === (c.name ?? null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="rounded-md border border-status-magenta px-1.5 py-0.5 text-sm w-28 focus:outline-none"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            setDraft(c.name ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <span className="group inline-flex items-center gap-1">
      <Link
        href={`/dashboard/contacts/${c.id}`}
        className="text-status-magenta hover:underline"
      >
        {contactFullName(c)}
      </Link>
      <button
        type="button"
        onClick={() => {
          setDraft(c.name ?? "");
          setEditing(true);
        }}
        title={t("inline.click_to_edit", "לחץ לעריכה")}
        className="text-xs text-gray-300 opacity-0 group-hover:opacity-100 hover:text-status-magenta"
      >
        ✎
      </button>
    </span>
  );
}
