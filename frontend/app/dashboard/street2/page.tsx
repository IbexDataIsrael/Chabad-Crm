"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Lock, MapPin } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import BuildingCelebration from "@/components/BuildingCelebration";
import { ActivistActivityPanel, ActivistPicker } from "@/components/street/ActivistActivityPanel";
import { CustomFieldValueDisplay, CustomFieldValueInput } from "@/components/CustomFieldValueInput";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useActiveCampaignFieldVisibility } from "@/lib/campaignFieldVisibility";
import { mapsHref } from "@/lib/contactActions";
import { useCustomFieldDefs } from "@/lib/customFields";
import { sortByFieldOrder, useFieldSettings } from "@/lib/fieldSettings";
import { recordStreetEvent, syncStreetActivity } from "@/lib/streetActivity";
import { applySamplePatch, buildSampleApartments } from "@/lib/sampleStreet";
import { groupByFloor } from "@/lib/floorGroups";
import { useLocalization } from "@/lib/localization";
import { FIXED_APARTMENT_PICKLIST_KEYS, usePicklist, usePicklistsMap } from "@/lib/picklists";
import {
  EMAIL_HINT,
  PHONE_HINT,
  isValidEmail,
  isValidPhone,
} from "@/lib/validation";
import {
  apartmentTitle,
  buildingDisplayName,
  type Apartment,
  type ApartmentPage,
  type ApartmentListItem,
  type CampaignBuildingCompletion,
  type PicklistField as PicklistFieldDef,
  type PicklistValue,
  type StreetActivity,
} from "@/lib/types";

// Reused as-is (RULE 0/1, docs/fixes70_street_v2.md): street2 must look and
// behave like /dashboard/street, so it imports street's own CSS module
// instead of a hand-maintained near-duplicate — this is a read-only import
// (a new consumer of the file), not a modification of street or its files.
import styles from "../street/street.module.css";
import doorStyles from "./doorStates.module.css";
import floorStyles from "./floors.module.css";

/** docs/fixes70_street_v2.md + docs/fixes71.md §C: street2 is street itself
 *  (same fetch/fields/tile-grid/sheet/edit mutations, verbatim data logic)
 *  plus a building-completion celebration (BuildingCelebration.tsx).
 *
 *  "Done" has no dedicated field/action anywhere in this app. Per explicit
 *  product decision, a door counts as done once it's been edited at least
 *  once through the SAME PUT /api/apartments/:id flow street already uses
 *  for any field — no new mutation, no new picklist value, no local-only
 *  state. The signal already exists: apartments are versioned (fixes19 §3)
 *  and every edit stamps the new active row's `root_id` to the lineage's
 *  original row id (see backend/app/routers/apartments.py
 *  `root_id=active.root_id or active.id`), while a never-edited row keeps
 *  `root_id == null`. So `apt.root_id != null` IS "this door has been
 *  worked" — real, persisted, survives refresh, computed from the exact
 *  same data/writes as every other edit on this page.
 *
 *  fixes71 §C.4: a building is complete (and fires the celebration) only
 *  once every "to_knock" apartment in it is done — a building with zero
 *  to-knock apartments never fires. `to_knock` is a real apartment custom
 *  field (backend/scripts/backfill_to_knock.py + apartments.py's
 *  _sync_to_knock keep it in sync with Jewish status), but it's never shown
 *  to activists (§C.3) — hard-excluded below, not just toggled off.
 *
 *  fixes71 §C.5/§C.6: every apartment field (fixed and custom alike) is a
 *  display candidate, filtered by the org's one ACTIVE CAMPAIGN's per-field
 *  visibility flags (useActiveCampaignFieldVisibility) instead of the old
 *  global useFieldSettings — this REPLACES street2's previous always-shown
 *  fixed rows + separate "Extra fields" section with one flat, uniformly
 *  gated row list. street.tsx is untouched and keeps its own old behavior.
 *
 *  Admins never load their own (whole-org) dataset here — that produced the
 *  "endless spinner". fixes74 §12: instead of bouncing them to the
 *  Apartments grid, an admin picks an activist and sees that activist's own
 *  view (?activist=<userId>): the same apartments, fields and progress,
 *  read-only, plus the activist's synced activity log and last-sync time.
 *  The activist's own app records mark / building-complete events and
 *  syncs them (lib/streetActivity.ts). */

type TextField = "name" | "phone" | "email" | "apartment_notes";
type PicklistField = "jewish_status" | "campaign_status" | "mezuzah_status";

const TEXT_FIELD_LOCK_KEY: Record<TextField, string> = {
  name: "resident",
  phone: "phone",
  email: "email",
  apartment_notes: "notes",
};

// fixes71 §B: field_registry.py's own keys for these fixed fields — the
// same vocabulary the new per-campaign visibility table uses, so a single
// admin-facing catalog covers fixed and custom fields alike.
const FIELD_KEY = {
  name: "apartments.name",
  phone: "apartments.phone",
  email: "apartments.email",
  jewish_status: "apartment.Jewish_status",
  campaign_status: "apartment.campaign_status",
  mezuzah_status: "apartment.mezuzah_status",
  language: "apartment.language",
  apartment_notes: "apartments.apartment_notes",
  report_number_id: "apartments.report_number_id",
} as const;

const TO_KNOCK_CUSTOM_FIELD_KEY = "to_knock";

function isDone(a: ApartmentListItem): boolean {
  return a.root_id != null;
}

// fixes71 §C.4: missing/undefined AND true both count as "needs a knock" —
// only an explicit false (set by _sync_to_knock for not_jewish/gentile/na)
// excludes a door from the completion requirement.
function isToKnock(a: ApartmentListItem): boolean {
  return a.custom_field_values?.[TO_KNOCK_CUSTOM_FIELD_KEY] !== false;
}

function buildingComplete(apts: ApartmentListItem[]): boolean {
  const required = apts.filter(isToKnock);
  return required.length > 0 && required.every(isDone);
}

export default function Street2Page() {
  const searchParams = useSearchParams();
  const { loading: authLoading, isAdmin, isCampaignManager, isShliach, user } = useAuth();
  const { t, lang } = useLocalization();
  // fixes74 §12: an admin / campaign manager viewing an activist's street2.
  const viewUserId =
    (isAdmin || isCampaignManager) && Number(searchParams.get("activist")) > 0
      ? Number(searchParams.get("activist"))
      : null;
  const viewer = viewUserId != null;
  // An admin with no activist picked sees the picker, never their own data.
  const needsPicker = !authLoading && isAdmin && !viewer;

  const [items, setItems] = useState<ApartmentListItem[]>([]);
  // fixes79: an activist with no taken task (and so no apartments) practises
  // on lib/sampleStreet's fixed building — every edit stays in this page.
  const [sampleMode, setSampleMode] = useState(false);
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [openId, setOpenId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [chipDraft, setChipDraft] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState<string | number | boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  // fixes88: autosave — a field tapped while another one is still saving
  // opens as soon as that save lands (on the new apartment version).
  const pendingEditRef = useRef<string | null>(null);

  const [celebration, setCelebration] = useState<{ open: boolean; label: string }>({
    open: false,
    label: "",
  });

  // fixes74 §12: the viewed activist's synced log + last-sync time, polled.
  // A newer sync also reloads the apartments, so the view follows the
  // activist's progress as their app syncs.
  const [activity, setActivity] = useState<StreetActivity | null>(null);
  useEffect(() => {
    if (!viewer) return;
    let lastSync: string | null | undefined;
    let cancelled = false;
    const poll = () =>
      apiFetch<StreetActivity>(`/api/street-activity/${viewUserId}`)
        .then((a) => {
          if (cancelled) return;
          setActivity(a);
          if (lastSync !== undefined && a.last_sync_at !== lastSync) {
            void load(true);
            void loadCompletions();
          }
          lastSync = a.last_sync_at;
        })
        .catch(() => {});
    void poll();
    const timer = window.setInterval(poll, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, viewUserId]);

  // fixes74 §12: the activist's own app syncs its log — on open, every
  // minute while open (a heartbeat, so "last sync" stays meaningful) and
  // when the connection comes back.
  useEffect(() => {
    if (!isShliach || !user) return;
    const uid = user.id;
    void syncStreetActivity(uid);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncStreetActivity(uid);
    }, 60000);
    const onOnline = () => void syncStreetActivity(uid);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [isShliach, user]);

  const jewish = usePicklist("apartment.Jewish_status");
  const campaign = usePicklist("apartment.campaign_status");
  const mezuzah = usePicklist("apartment.mezuzah_status");
  const language = usePicklist("apartment.language");

  // fixes71 §C.5: ordering stays global (untouched); visibility now comes
  // from the active campaign, not this hook's isFieldVisible.
  const { orderFor } = useFieldSettings();
  // Named activeCampaign, not campaign — that name is already taken by the
  // apartment.campaign_status picklist hook below.
  const { campaign: activeCampaign, isVisible: campaignVisible } = useActiveCampaignFieldVisibility();

  // fixes72 §A: buildings completed under the active campaign are persisted
  // server-side and excluded from the list entirely — not just celebrated
  // once and left visible. `completionsReady` gates the self-healing effect
  // below so it never fires before we actually know what's already recorded.
  const [completedBuildingIds, setCompletedBuildingIds] = useState<Set<number>>(new Set());
  const [completionsReady, setCompletionsReady] = useState(false);

  function loadCompletions() {
    if (!activeCampaign?.id) {
      setCompletedBuildingIds(new Set());
      setCompletionsReady(true); // no active campaign — nothing to scope to, show everything
      return Promise.resolve();
    }
    setCompletionsReady(false);
    return apiFetch<CampaignBuildingCompletion[]>(`/api/campaigns/${activeCampaign.id}/building-completions`)
      .then((rows) => setCompletedBuildingIds(new Set(rows.map((r) => r.building_id))))
      .catch(() => setCompletedBuildingIds(new Set()))
      .finally(() => setCompletionsReady(true));
  }
  useEffect(() => {
    void loadCompletions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaign?.id]);
  const [customDefs, setCustomDefs] = useState<PicklistFieldDef[]>([]);
  const customFieldDefs = useCustomFieldDefs("apartment").filter(
    (d) => d.field_type !== "select" && d.field_key !== TO_KNOCK_CUSTOM_FIELD_KEY,
  );
  const { map: customMap, labelFor: customLabel, display: customDisplay } = usePicklistsMap(customDefs.map((d) => d.field_key));

  useEffect(() => {
    apiFetch<PicklistFieldDef[]>("/api/picklists")
      .then((defs) =>
        setCustomDefs(
          defs.filter(
            (d) => d.entity_type === "apartment" && !FIXED_APARTMENT_PICKLIST_KEYS.includes(d.field_key),
          ),
        ),
      )
      .catch(() => {});
  }, []);

  const shliachViewConfig = user?.organization?.shliach_view_config;
  const shliachEditDisabled = isShliach && !!shliachViewConfig?.disable_edit;
  const lockedFields = new Set(
    isShliach && Array.isArray(shliachViewConfig?.apartment_edit_locked_fields)
      ? (shliachViewConfig.apartment_edit_locked_fields as string[])
      : [],
  );
  // fixes74 §12: the admin's view of an activist is read-only.
  const fieldLocked = (key: string) => viewer || shliachEditDisabled || lockedFields.has(key);

  // fixes74 §13: the admin's order for the apartment card's fields
  // (shliach-config "הגדרות לתצוגת פעילים"). Unlisted fields follow, in
  // their default order; hidden (falsy) rows drop out.
  const fieldOrder: string[] = Array.isArray(shliachViewConfig?.street2_field_order)
    ? shliachViewConfig.street2_field_order
    : [];
  function orderStreetRows(rows: [string, ReactNode][]): [string, ReactNode][] {
    const rank = new Map(fieldOrder.map((k, i) => [k, i]));
    return rows
      .filter(([, node]) => !!node)
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const ra = rank.get(a.row[0]);
        const rb = rank.get(b.row[0]);
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return a.index - b.index;
      })
      .map((x) => x.row);
  }

  async function load(quiet = false) {
    if (!quiet) setBusy(true);
    setLoadError(false);
    try {
      const all: ApartmentListItem[] = [];
      let page = 1;
      let total = Infinity;
      const asUser = viewer ? `&as_user_id=${viewUserId}` : "";
      while (all.length < total) {
        const res = await apiFetch<ApartmentPage>(
          `/api/apartments/list?page=${page}&page_size=100${asUser}`,
        );
        total = res.total;
        all.push(...res.items);
        if (res.items.length === 0) break;
        page++;
      }
      // Real apartments always win: an activist still covered by areas
      // (fixes19) keeps seeing them even without a task.
      const practice =
        !viewer && isShliach && user?.has_active_task === false && all.length === 0;
      setSampleMode(practice);
      setItems(practice ? buildSampleApartments(t("street.sample_building", "בניין לדוגמא")) : all);
    } catch {
      setLoadError(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (authLoading || needsPicker) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, needsPicker, viewUserId]);

  const buildings = useMemo(() => {
    const map = new Map<
      number,
      { id: number; name: string; address: string | null; area: string | null; apartments: ApartmentListItem[] }
    >();
    for (const a of items) {
      if (!map.has(a.building_id)) {
        map.set(a.building_id, {
          id: a.building_id,
          name: buildingDisplayName({
            id: a.building_id,
            building_name: a.building_name,
            building_address: a.building_address,
          }),
          address: a.building_address,
          area: a.area_name,
          apartments: [],
        });
      }
      map.get(a.building_id)!.apartments.push(a);
    }
    // fixes72 §A: a building persisted-complete for the active campaign is
    // excluded entirely — "not appear again" per the product requirement,
    // not just celebrated-and-left-visible.
    return Array.from(map.values()).filter((b) => !completedBuildingIds.has(b.id));
  }, [items, completedBuildingIds]);

  // fixes72 §A: self-healing — if an admin undoes a completion (or this is
  // simply the first load after the DB record didn't exist yet) but the
  // underlying apartments already satisfy completion, silently persist it
  // again so the building re-hides itself without requiring a redundant
  // edit. Never celebrates — only a fresh in-session transition does that.
  useEffect(() => {
    if (viewer || sampleMode || !completionsReady || !activeCampaign?.id || items.length === 0) return;
    const byBuilding = new Map<number, ApartmentListItem[]>();
    for (const a of items) {
      const list = byBuilding.get(a.building_id);
      if (list) list.push(a);
      else byBuilding.set(a.building_id, [a]);
    }
    const activeCampaignId = activeCampaign.id;
    setCompletedBuildingIds((prev) => {
      const additions: number[] = [];
      for (const [buildingId, apts] of byBuilding) {
        if (!prev.has(buildingId) && buildingComplete(apts)) additions.push(buildingId);
      }
      if (additions.length === 0) return prev;
      for (const buildingId of additions) {
        apiFetch(`/api/campaigns/${activeCampaignId}/building-completions`, {
          method: "POST",
          body: JSON.stringify({ building_id: buildingId }),
        }).catch(() => {});
      }
      return new Set([...prev, ...additions]);
    });
  }, [items, completionsReady, activeCampaign?.id, viewer, sampleMode]);

  // fixes73: moving on from an unfinished building needs an explicit
  // acknowledgement. Opening a door in a building checks the ONE building
  // right before it in the route (list) order — whether or not the activist
  // ever tapped a door there, so scrolling past a building can't skip it.
  // Once the activist confirms for a building, doors in it open freely
  // afterwards. Acknowledgements are persisted per user so a refresh doesn't
  // re-nag; read in an effect keyed by the user id — not a lazy-init
  // usePersistentState — because `user` loads async (fixes70 bug).
  const [ackedBuildingIds, setAckedBuildingIds] = useState<Set<number>>(new Set());
  const [leaveWarn, setLeaveWarn] = useState<{
    buildingName: string;
    pending: ApartmentListItem[];
    targetAptId: number;
    targetBuildingId: number;
  } | null>(null);
  const ackKey = user ? `crm.street2.ackedBuildings.${user.id}` : null;

  useEffect(() => {
    if (!ackKey) return;
    try {
      const raw = window.localStorage.getItem(ackKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      setAckedBuildingIds(new Set(Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : []));
    } catch {
      setAckedBuildingIds(new Set());
    }
  }, [ackKey]);

  // Route order = the order buildings appear in the list, INCLUDING
  // completed (hidden) ones, so a hidden finished building counts as the
  // previous one and correctly never warns.
  const buildingOrder = useMemo(() => {
    const seen: number[] = [];
    const set = new Set<number>();
    for (const a of items) {
      if (!set.has(a.building_id)) {
        set.add(a.building_id);
        seen.push(a.building_id);
      }
    }
    return seen;
  }, [items]);

  function openDoor(a: ApartmentListItem) {
    if (viewer) {
      setOpenId(a.id);
      return;
    }
    const idx = buildingOrder.indexOf(a.building_id);
    const prevId = idx > 0 ? buildingOrder[idx - 1] : null;
    if (prevId != null && !ackedBuildingIds.has(a.building_id) && !completedBuildingIds.has(prevId)) {
      const prevApts = items.filter((x) => x.building_id === prevId);
      // Same predicates as buildingComplete(): only to-knock doors are
      // required, so only those are listed as still needing an edit.
      const pending = prevApts.filter((x) => isToKnock(x) && !isDone(x));
      if (pending.length > 0) {
        setLeaveWarn({
          buildingName: buildingDisplayName({
            id: prevId,
            building_name: prevApts[0].building_name,
            building_address: prevApts[0].building_address,
          }),
          pending,
          targetAptId: a.id,
          targetBuildingId: a.building_id,
        });
        return;
      }
    }
    setOpenId(a.id);
  }

  function confirmLeave() {
    if (!leaveWarn) return;
    const next = new Set(ackedBuildingIds).add(leaveWarn.targetBuildingId);
    setAckedBuildingIds(next);
    if (ackKey) {
      try {
        window.localStorage.setItem(ackKey, JSON.stringify([...next]));
      } catch {
        /* storage unavailable — the user just gets asked again after a refresh */
      }
    }
    setOpenId(leaveWarn.targetAptId);
    setLeaveWarn(null);
  }

  const openApt = items.find((a) => a.id === openId) ?? null;

  // fixes88: every field opens by a tap on its row (no pencil) and saves
  // itself (no Save/Cancel) — see EditableRow / PicklistRow.
  function startEdit(apt: ApartmentListItem, field: string) {
    setSaveErr("");
    setEditingField(field);
    if (field === "name" || field === "phone" || field === "email" || field === "apartment_notes") {
      setTextDraft((apt[field as TextField] as string | null) ?? "");
    } else if (field === "language") {
      setChipDraft(apt.language ?? []);
    } else if (field.startsWith(CUSTOM_FIELD_PREFIX)) {
      setCustomDraft(apt.custom_field_values?.[field.slice(CUSTOM_FIELD_PREFIX.length)] ?? null);
    }
  }

  function beginEdit(field: string) {
    if (!openApt) return;
    if (saving) {
      pendingEditRef.current = field;
      return;
    }
    startEdit(openApt, field);
  }

  function toggleChip(value: string, multi: boolean) {
    setChipDraft((prev) => {
      if (multi) {
        return prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      }
      return prev.includes(value) ? [] : [value];
    });
  }

  async function commitPatch(patch: Record<string, unknown>, field: string) {
    if (!openApt || saving) return;
    const buildingId = openApt.building_id;
    // fixes71 §C.4: building-level before/after (not a single-apartment
    // "was this door done" flag) — correctly avoids a refire if a
    // *non*-to-knock door is edited after the building's real to-knock
    // doors were already all done.
    const wasComplete = buildingComplete(items.filter((a) => a.building_id === buildingId));
    const wasDone = isDone(openApt);
    setSaving(true);
    setSaveErr("");
    try {
      // fixes19 §3: apartments are versioned — a PUT returns a NEW row with a
      // new id (and, as a side effect, a non-null root_id — see file header).
      const saved: Partial<Apartment> = sampleMode
        ? applySamplePatch(openApt, patch)
        : await apiFetch<Apartment>(`/api/apartments/${openApt.id}`, {
            method: "PUT",
            body: JSON.stringify(patch),
          });
      const merged: ApartmentListItem = { ...openApt, ...saved };
      const bLabel = buildingDisplayName({
        id: buildingId,
        building_name: merged.building_name,
        building_address: merged.building_address,
      });
      // fixes74 §12: a door's first edit marks it done — log it for the
      // admin's view of this activist (queued + synced, see lib/streetActivity).
      if (user && isShliach && !sampleMode && !wasDone && isDone(merged)) {
        recordStreetEvent(user.id, {
          event_type: "mark",
          apartment_id: merged.id,
          building_id: buildingId,
          label: `${bLabel} · ${apartmentTitle(merged)}`,
        });
      }
      setItems((prev) => {
        const next = prev.map((it) => (it.id === openApt.id ? merged : it));
        // RULE 3: fire only when THIS save is what completes the building —
        // never on initial load, never re-firing for an already-complete one.
        if (!wasComplete && buildingComplete(next.filter((a) => a.building_id === buildingId))) {
          if (user && isShliach && !sampleMode) {
            recordStreetEvent(user.id, {
              event_type: "building_complete",
              apartment_id: null,
              building_id: buildingId,
              label: bLabel,
            });
          }
          setCelebration({ open: true, label: buildingDisplayName({
            id: buildingId,
            building_name: merged.building_name,
            building_address: merged.building_address,
          }) });
          // fixes72 §A: persist the completion (best-effort — a failed POST
          // here must never surface as a save error, the apartment edit
          // itself already succeeded; the self-healing effect will retry
          // it on next load regardless) and hide the building immediately,
          // without waiting for a reload.
          if (sampleMode) {
            // Practice run: hide the finished sample building locally only.
            setCompletedBuildingIds((p) => new Set(p).add(buildingId));
          } else if (activeCampaign?.id) {
            const activeCampaignId = activeCampaign.id;
            apiFetch(`/api/campaigns/${activeCampaignId}/building-completions`, {
              method: "POST",
              body: JSON.stringify({ building_id: buildingId }),
            })
              .then(() => setCompletedBuildingIds((p) => new Set(p).add(buildingId)))
              .catch(() => {});
          }
        }
        return next;
      });
      setOpenId(merged.id);
      setEditingField((cur) => (cur === field ? null : cur));
      const queued = pendingEditRef.current;
      pendingEditRef.current = null;
      if (queued) startEdit(merged, queued);
    } catch (err) {
      pendingEditRef.current = null;
      setSaveErr(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setSaving(false);
    }
  }

  // fixes88: autosave only on a real change — every PUT makes a new
  // apartment version and counts the door as done, so leaving a field
  // untouched must never save.
  function closeEdit(field: string) {
    setSaveErr("");
    setEditingField((cur) => (cur === field ? null : cur));
  }

  function saveText(field: TextField) {
    if (!openApt) return;
    const v = textDraft.trim();
    if (v === ((openApt[field] as string | null) ?? "").trim()) {
      closeEdit(field);
      return;
    }
    if (field === "phone" && v !== "" && !isValidPhone(v)) {
      setSaveErr(t("validation.phone_hint", PHONE_HINT));
      return;
    }
    if (field === "email" && v !== "" && !isValidEmail(v)) {
      setSaveErr(t("validation.email_hint", EMAIL_HINT));
      return;
    }
    commitPatch({ [field]: v === "" ? null : v }, field);
  }

  function saveSinglePicklist(field: PicklistField, value: string | null) {
    if (!openApt) return;
    if ((openApt[field] ?? null) === value) {
      closeEdit(field);
      return;
    }
    commitPatch({ [field]: value }, field);
  }

  function saveLanguage() {
    if (!openApt) return;
    const before = [...(openApt.language ?? [])].sort().join("|");
    if ([...chipDraft].sort().join("|") === before) {
      closeEdit("language");
      return;
    }
    commitPatch({ language: chipDraft }, "language");
  }

  const doorStateLabel = {
    knock: t("street.door_to_knock", "לדפוק"),
    visited: t("street.door_visited", "בוקר"),
    idle: t("street.door_no_knock", "לא נדרש"),
  };

  if (authLoading) {
    return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  }
  if (needsPicker) {
    return (
      <div className={styles.pageBg}>
        <div className={styles.wrap}>
          <ActivistPicker />
        </div>
      </div>
    );
  }

  const toKnockItems = items.filter(isToKnock);
  const buildingsDoneCount = buildingOrder.filter((id) => completedBuildingIds.has(id)).length;

  const buildingCountFor = (buildingId: number) =>
    items.filter((a) => a.building_id === buildingId).length;

  return (
    <div className={styles.pageBg}>
      <Link href={viewer ? "/dashboard/street2" : "/dashboard/apartments"} className={styles.backLink}>
        {viewer
          ? t("street_view.back", "← חזרה לבחירת פעיל")
          : t("page.back_to_apartments", "← חזרה לדירות")}
      </Link>
      <div className={styles.wrap}>
        {viewer && (
          <ActivistActivityPanel
            activity={activity}
            doorsDone={toKnockItems.filter(isDone).length}
            doorsToKnock={toKnockItems.length}
            buildingsDone={buildingsDoneCount}
            buildingsTotal={buildingOrder.length}
          />
        )}
        <h1
          style={{
            textAlign: "center",
            color: "#dff5e6",
            fontWeight: 800,
            fontSize: 20,
            margin: "0 0 14px",
          }}
        >
          {t("street.title", "המסלול שלי")}
        </h1>
        {sampleMode && !busy && (
          <div
            role="status"
            style={{
              background: "#fde047",
              color: "#422006",
              border: "2px dashed #a16207",
              borderRadius: 14,
              padding: "12px 14px",
              margin: "0 0 14px",
              textAlign: "center",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 20 }}>
              {t("street.sample_building", "בניין לדוגמא")}
            </div>
            <div style={{ fontSize: 14, marginTop: 4 }}>
              {t(
                "street.sample_notice",
                "אין לך עדיין משימה פעילה — זה בניין לתרגול בלבד. השינויים כאן לא נשמרים. כשתקבל/י משימה, הדירות שלך יופיעו כאן.",
              )}
            </div>
          </div>
        )}
        <div className={doorStyles.legend}>
          <span className={doorStyles.legendItem}>
            <span className={`${doorStyles.swatch} ${doorStyles.swatchKnock}`} />
            {doorStateLabel.knock}
          </span>
          <span className={doorStyles.legendItem}>
            <span className={`${doorStyles.swatch} ${doorStyles.swatchVisited}`} />
            {doorStateLabel.visited}
          </span>
          <span className={doorStyles.legendItem}>
            <span className={`${doorStyles.swatch} ${doorStyles.swatchIdle}`} />
            {doorStateLabel.idle}
          </span>
        </div>

        {busy ? (
          <div className={styles.state}>
            <div className={styles.spinner} />
            {t("action.loading", "טוען…")}
          </div>
        ) : loadError ? (
          <div className={styles.state}>
            <div className={styles.stateBig}>⚠️</div>
            <div>{t("apt.load_failed", "טעינת הדירות נכשלה. נסה שוב.")}</div>
            <button type="button" className={styles.retry} onClick={() => load()}>
              {t("action.retry", "נסה שוב")}
            </button>
          </div>
        ) : buildings.length === 0 ? (
          <div className={styles.state}>
            <div className={styles.stateBig}>🏠</div>
            <div>{t("apt.no_apartments_page", "אין דירות להצגה.")}</div>
          </div>
        ) : (
          buildings.map((b) => (
            <div key={b.id} className={styles.building}>
              <div className={styles.bHead}>
                <div className={styles.bBadge}>{b.apartments.length}</div>
                <div className={styles.bInfo}>
                  <div className={styles.bName}>{b.name}</div>
                  {b.address && <div className={styles.bAddr}>{b.address}</div>}
                  {b.area && <span className={styles.bArea}>{b.area}</span>}
                </div>
                {b.address && (
                  <a
                    className={styles.bMap}
                    href={mapsHref(b.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t("apt.navigate", "ניווט בגוגל מפות")}
                  >
                    <MapPin className="h-5 w-5" />
                  </a>
                )}
              </div>
              {/* fixes77: one section per floor (stored floor name, backend
                  order kept), divider between sections via floorStyles; the
                  door tiles inside are unchanged. */}
              {groupByFloor(b.apartments).map((f) => (
                <section key={f.floor ?? ""} className={floorStyles.floor}>
                  <div className={floorStyles.floorLabel}>
                    {f.floor !== null
                      ? `${t("apartments.floor", "קומה")} ${f.floor}`
                      : t("apartments.floor_unknown", "קומה לא צוינה")}
                  </div>
                  <div className={`${styles.doors} ${floorStyles.floorDoors}`}>
                    {f.apartments.map((a) => {
                      // Visited wins over to-knock: once a door's been edited its
                      // knock is done. Same predicates the completion logic uses.
                      const state = isDone(a) ? "visited" : isToKnock(a) ? "knock" : "idle";
                      return (
                      <button
                        key={a.id}
                        type="button"
                        className={`${styles.door} ${doorStyles[state]}`}
                        title={doorStateLabel[state]}
                        onClick={() => openDoor(a)}
                      >
                        <span className={styles.knob} />
                        {state === "knock" && <span className={doorStyles.tag}>{doorStateLabel.knock}</span>}
                        {state === "visited" && (
                          <span className={doorStyles.check} aria-label={doorStateLabel.visited}>
                            <Check className="h-3 w-3" strokeWidth={3.5} />
                          </span>
                        )}
                        <div className={styles.dApt}>{a.apartment_name || "—"}</div>
                        <div className={styles.dFloor}>
                          {a.floor ? `${t("apartments.floor", "קומה")} ${a.floor}` : " "}
                        </div>
                        {/* fixes71 §C.5: hidden fields aren't displayed anywhere,
                            including this door-tile quick-glance headline. */}
                        {campaignVisible(FIELD_KEY.jewish_status) && (
                          <div className={styles.dName}>{jewish.labelFor(a.jewish_status)}</div>
                        )}
                      </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ))
        )}
      </div>

      {openApt && (
        <div
          className={styles.overlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpenId(null);
          }}
        >
          <div className={styles.sheet} role="dialog" aria-modal="true">
            <div className={styles.grab} />
            <div className={styles.sHead}>
              <div className={styles.bBadge}>{buildingCountFor(openApt.building_id)}</div>
              <div className={styles.bInfo}>
                <div className={styles.bName}>
                  {buildingDisplayName({
                    id: openApt.building_id,
                    building_name: openApt.building_name,
                    building_address: openApt.building_address,
                  })}
                </div>
                {openApt.building_address && (
                  <div className={styles.bAddr}>{openApt.building_address}</div>
                )}
                {openApt.area_name && <span className={styles.bArea}>{openApt.area_name}</span>}
              </div>
              {openApt.building_address && (
                <a
                  className={styles.bMap}
                  href={mapsHref(openApt.building_address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t("apt.navigate", "ניווט בגוגל מפות")}
                >
                  <MapPin className="h-5 w-5" />
                </a>
              )}
            </div>

            <div className={styles.aptTitle}>{apartmentTitle(openApt)}</div>

            <div className={styles.rows}>
              {/* fixes74 §13: one list of every visible field — built-in and
                  custom alike — ordered by the admin's shliach-config order
                  (street2_field_order); fields it doesn't mention keep the
                  previous default order after the ordered ones. Hidden
                  fields never enter the list. */}
              {orderStreetRows([
              [FIELD_KEY.name, campaignVisible(FIELD_KEY.name) && (
                <EditableRow
                  label={t("apartments.name", "שם דייר")}
                  field="name"
                  locked={fieldLocked(TEXT_FIELD_LOCK_KEY.name)}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => closeEdit("name")}
                  onSave={() => saveText("name")}
                  saving={saving}
                  saveErr={saveErr}
                  t={t}
                  display={openApt.name || "—"}
                  empty={!openApt.name}
                  editor={
                    <input
                      type="text"
                      value={textDraft}
                      onChange={(e) => setTextDraft(e.target.value)}
                    />
                  }
                />
              )],
              [FIELD_KEY.phone, campaignVisible(FIELD_KEY.phone) && (
                <EditableRow
                  label={t("apartments.phone", "טלפון")}
                  field="phone"
                  locked={fieldLocked(TEXT_FIELD_LOCK_KEY.phone)}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => closeEdit("phone")}
                  onSave={() => saveText("phone")}
                  saving={saving}
                  saveErr={saveErr}
                  t={t}
                  display={
                    openApt.phone ? (
                      <a
                        href={`tel:${openApt.phone}`}
                        dir="ltr"
                        className={styles.rowLink}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {openApt.phone}
                      </a>
                    ) : (
                      "—"
                    )
                  }
                  empty={!openApt.phone}
                  editor={
                    <input
                      type="tel"
                      dir="ltr"
                      value={textDraft}
                      onChange={(e) => setTextDraft(e.target.value)}
                    />
                  }
                />
              )],
              [FIELD_KEY.email, campaignVisible(FIELD_KEY.email) && (
                <EditableRow
                  label={t("apartments.email", "אימייל")}
                  field="email"
                  locked={fieldLocked(TEXT_FIELD_LOCK_KEY.email)}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => closeEdit("email")}
                  onSave={() => saveText("email")}
                  saving={saving}
                  saveErr={saveErr}
                  t={t}
                  display={
                    openApt.email ? (
                      <a
                        href={`mailto:${openApt.email}`}
                        dir="ltr"
                        className={styles.rowLink}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {openApt.email}
                      </a>
                    ) : (
                      "—"
                    )
                  }
                  empty={!openApt.email}
                  editor={
                    <input
                      type="email"
                      dir="ltr"
                      value={textDraft}
                      onChange={(e) => setTextDraft(e.target.value)}
                    />
                  }
                />
              )],

              [FIELD_KEY.jewish_status, campaignVisible(FIELD_KEY.jewish_status) && (
                <PicklistRow
                  label={t("picklist.apartment.Jewish_status", "יהדות")}
                  field="jewish_status"
                  locked={fieldLocked("jewish_status")}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => closeEdit("jewish_status")}
                  onPick={(v) => saveSinglePicklist("jewish_status", v)}
                  saving={saving}
                  saveErr={saveErr}
                  t={t}
                  value={openApt.jewish_status}
                  labelFor={jewish.labelFor}
                  options={jewish.options}
                  display={jewish.display}
                  chipDraft={chipDraft}
                  onToggleChip={(v) => toggleChip(v, false)}
                />
              )],
              [FIELD_KEY.campaign_status, campaignVisible(FIELD_KEY.campaign_status) && (
                <PicklistRow
                  label={t("picklist.apartment.campaign_status", "סטטוס קמפיין")}
                  field="campaign_status"
                  locked={fieldLocked("campaign_status")}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => closeEdit("campaign_status")}
                  onPick={(v) => saveSinglePicklist("campaign_status", v)}
                  saving={saving}
                  saveErr={saveErr}
                  t={t}
                  value={openApt.campaign_status}
                  labelFor={campaign.labelFor}
                  options={campaign.options}
                  display={campaign.display}
                  chipDraft={chipDraft}
                  onToggleChip={(v) => toggleChip(v, false)}
                />
              )],
              [FIELD_KEY.mezuzah_status, campaignVisible(FIELD_KEY.mezuzah_status) && (
                <PicklistRow
                  label={t("picklist.apartment.mezuzah_status", "מזוזה")}
                  field="mezuzah_status"
                  locked={fieldLocked("mezuzah_status")}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => closeEdit("mezuzah_status")}
                  onPick={(v) => saveSinglePicklist("mezuzah_status", v)}
                  saving={saving}
                  saveErr={saveErr}
                  t={t}
                  value={openApt.mezuzah_status}
                  labelFor={mezuzah.labelFor}
                  options={mezuzah.options}
                  display={mezuzah.display}
                  chipDraft={chipDraft}
                  onToggleChip={(v) => toggleChip(v, false)}
                />
              )],
              [FIELD_KEY.language, campaignVisible(FIELD_KEY.language) && (
                <PicklistRow
                  label={t("picklist.apartment.language", "שפה")}
                  field="language"
                  locked={fieldLocked("language")}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => closeEdit("language")}
                  onSave={saveLanguage}
                  multi
                  saving={saving}
                  saveErr={saveErr}
                  t={t}
                  value={openApt.language}
                  labelFor={language.labelFor}
                  options={language.options}
                  display={language.display}
                  chipDraft={chipDraft}
                  onToggleChip={(v) => toggleChip(v, true)}
                />
              )],

              [FIELD_KEY.report_number_id, campaignVisible(FIELD_KEY.report_number_id) && (
                <div className={styles.row}>
                  <div className={styles.lbl}>{t("apartments.report_number_id", "מספר דוח")}</div>
                  <div className={`${styles.val} ${openApt.report_number_name ? "" : styles.valEmpty}`}>
                    {openApt.report_number_name || "—"}
                  </div>
                  <span className={`${styles.act} ${styles.lock}`}>
                    <Lock className="h-3.5 w-3.5" />
                  </span>
                </div>
              )],

              [FIELD_KEY.apartment_notes, campaignVisible(FIELD_KEY.apartment_notes) && (
                <EditableRow
                  label={t("apartments.apartment_notes", "הערות")}
                  field="apartment_notes"
                  top
                  multiline
                  locked={fieldLocked(TEXT_FIELD_LOCK_KEY.apartment_notes)}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => closeEdit("apartment_notes")}
                  onSave={() => saveText("apartment_notes")}
                  saving={saving}
                  saveErr={saveErr}
                  t={t}
                  display={<div className={styles.notesCard}>{openApt.apartment_notes || "—"}</div>}
                  empty={!openApt.apartment_notes}
                  editor={<textarea value={textDraft} onChange={(e) => setTextDraft(e.target.value)} />}
                />
              )],

              /* fixes71 §C.5/§C.6: every remaining apartment field (custom
                  picklists + custom fields, to_knock hard-excluded) in this
                  SAME list. Editable like the fixed fields — every apartment
                  field the campaign doesn't hide is editable unless
                  shliach-config locks it (lock keys: a custom picklist's
                  field_key, `customfield.apartment.<key>` for a custom
                  field — same convention as shliach-config's lock list). */
              ...sortByFieldOrder(
                [
                  ...customDefs
                    .filter((d) => campaignVisible(d.field_key))
                    .map((d) => ({
                      key: d.field_key,
                      node: (
                        <PicklistRow
                          label={(lang === "en" ? d.english_label || d.label : d.label) || d.field_key}
                          field={d.field_key}
                          locked={fieldLocked(d.field_key)}
                          editingField={editingField}
                          onBeginEdit={beginEdit}
                          onCancel={() => closeEdit(d.field_key)}
                          onPick={(v) => {
                            if ((openApt.picklist_values?.[d.field_key] ?? null) === v) {
                              closeEdit(d.field_key);
                              return;
                            }
                            commitPatch({ picklist_values: { [d.field_key]: v } }, d.field_key);
                          }}
                          saving={saving}
                          saveErr={saveErr}
                          t={t}
                          value={openApt.picklist_values?.[d.field_key] ?? null}
                          labelFor={(v) => customLabel(d.field_key, v)}
                          options={(customMap[d.field_key] ?? []).filter((o) => o.is_active)}
                          display={customDisplay}
                          chipDraft={chipDraft}
                          onToggleChip={(v) => toggleChip(v, false)}
                        />
                      ),
                    })),
                  ...customFieldDefs
                    .filter((d) => campaignVisible(`customfield.apartment.${d.field_key}`))
                    .map((d) => {
                      const key = `customfield.apartment.${d.field_key}`;
                      const value = openApt.custom_field_values?.[d.field_key] ?? null;
                      return {
                        key,
                        node: (
                          <EditableRow
                            label={
                              (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                              d.field_key
                            }
                            field={key}
                            locked={fieldLocked(key)}
                            editingField={editingField}
                            onBeginEdit={beginEdit}
                            onCancel={() => closeEdit(key)}
                            onSave={() => {
                              const norm = (x: unknown) => (x === "" || x === undefined ? null : x);
                              if (norm(customDraft) === norm(value)) {
                                closeEdit(key);
                                return;
                              }
                              commitPatch({ custom_field_values: { [d.field_key]: customDraft } }, key);
                            }}
                            saving={saving}
                            saveErr={saveErr}
                            t={t}
                            display={<CustomFieldValueDisplay fieldType={d.field_type} value={value} />}
                            empty={value == null || value === ""}
                            editor={
                              <CustomFieldValueInput
                                fieldType={d.field_type}
                                value={customDraft}
                                onChange={setCustomDraft}
                              />
                            }
                          />
                        ),
                      };
                    }),
                ],
                (e) => e.key,
                orderFor,
              ).map((e): [string, ReactNode] => [e.key, e.node]),
              ]).map(([key, node]) => (
                <Fragment key={key}>{node}</Fragment>
              ))}

              <div className={styles.row}>
                <div className={styles.lbl}>{t("apt.contact", "איש קשר")}</div>
                <div className={`${styles.val} ${openApt.contact_name ? "" : styles.valEmpty}`}>
                  {openApt.contact_id && openApt.contact_name ? (
                    <Link href={`/dashboard/contacts/${openApt.contact_id}`} className={styles.rowLink}>
                      {openApt.contact_name}
                    </Link>
                  ) : (
                    t("apt.no_contact", "ללא איש קשר")
                  )}
                </div>
                <span className={`${styles.act} ${styles.lock}`}>
                  <Lock className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>

            <div className={styles.section}>
              <h3>
                {t("street.visits_title", "ביקורים")}{" "}
                <span className={styles.soon}>{t("street.visits_soon", "בקרוב")}</span>
              </h3>
              <div className={styles.muted}>
                {t(
                  "street.visits_hint",
                  "רשימת הביקורים לדירה תופיע כאן כשהמערכת תתמוך בזה.",
                )}
              </div>
            </div>

            <div className={styles.footNote}>
              {t(
                "street.footnote",
                "כל שדה מהמערכת הקיימת מופיע כאן — שום דבר לא הלך לאיבוד.",
              )}
            </div>

            <button
              type="button"
              className={styles.closeBtn}
              onClick={() => setOpenId(null)}
            >
              {t("action.close", "סגור")}
            </button>
          </div>
        </div>
      )}

      {leaveWarn && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLeaveWarn(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-sm bg-card text-foreground rounded-xl shadow-xl p-5 space-y-4"
          >
            <h2 className="text-lg font-bold">
              {t("street.building_incomplete_title", "הבניין {name} לא הושלם").replace(
                "{name}",
                leaveWarn.buildingName,
              )}
            </h2>
            <p className="text-sm">
              {t(
                "street.building_incomplete_body",
                "הדירות הבאות צריכות לעבור לפחות עריכה אחת כדי להיחשב כבוצעו:",
              )}
            </p>
            <ul className="max-h-60 overflow-y-auto rounded-md border divide-y text-sm">
              {leaveWarn.pending.map((a) => (
                <li key={a.id} className="px-3 py-2 flex items-center justify-between gap-3">
                  <span className="font-semibold">
                    {t("apartments.apartment_name", "מספר דירה")} {a.apartment_name || `#${a.id}`}
                  </span>
                  {a.floor && (
                    <span className="text-muted-foreground">
                      {t("apartments.floor", "קומה")} {a.floor}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              {t(
                "street.building_incomplete_question",
                "לעבור לבניין הבא למרות שהבניין הזה לא הושלם?",
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="button" onClick={confirmLeave}>
                {t("street.building_incomplete_continue", "הבנתי, עבור לבניין הבא")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setLeaveWarn(null)}>
                {t("street.building_incomplete_stay", "הישאר בבניין")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <BuildingCelebration
        open={celebration.open}
        buildingLabel={celebration.label}
        onClose={() => setCelebration((c) => ({ ...c, open: false }))}
      />
    </div>
  );
}

/** fixes88: the custom-field edit key prefix (matches shliach-config locks). */
const CUSTOM_FIELD_PREFIX = "customfield.apartment.";

interface EditableRowProps {
  label: string;
  field: string;
  locked: boolean;
  editingField: string | null;
  onBeginEdit: (field: string) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveErr: string;
  t: (key: string, fallback?: string) => string;
  display: ReactNode;
  empty: boolean;
  editor: ReactNode;
  /** Top-align label + value (notes). */
  top?: boolean;
  /** Enter adds a line instead of saving (textarea). */
  multiline?: boolean;
}

/** fixes88: tap the row to edit — no pencil, no Save/Cancel. The value saves
 *  when focus leaves the field (or Enter on a single-line field); Esc drops
 *  the change. Locked fields keep their lock and never open. */
function EditableRow({
  label,
  field,
  locked,
  editingField,
  onBeginEdit,
  onCancel,
  onSave,
  saving,
  saveErr,
  t,
  display,
  empty,
  editor,
  top,
  multiline,
}: EditableRowProps) {
  const isEditing = editingField === field;
  const boxRef = useRef<HTMLDivElement>(null);
  // Esc unmounts the editor; a blur that follows must not save the draft.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!isEditing) return;
    cancelledRef.current = false;
    const el = boxRef.current?.querySelector<HTMLElement>("input, textarea, select, button");
    el?.focus();
  }, [isEditing]);

  const rowClass = `${styles.row} ${top ? styles.rowTop : ""}`;
  if (isEditing) {
    return (
      <div className={rowClass}>
        <div className={styles.lbl}>{label}</div>
        <div
          ref={boxRef}
          className={styles.editbox}
          onBlur={(e) => {
            if (cancelledRef.current) return;
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            onSave();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              cancelledRef.current = true;
              onCancel();
            } else if (e.key === "Enter" && !multiline && (e.target as HTMLElement).tagName === "INPUT") {
              e.preventDefault();
              onSave();
            }
          }}
        >
          {editor}
          {saving && <div className={doorStyles.savingHint}>{t("action.saving", "שומר…")}</div>}
          {saveErr && <div className={styles.editErr}>{saveErr}</div>}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`${rowClass} ${locked ? "" : doorStyles.editableRow}`}
      role={locked ? undefined : "button"}
      tabIndex={locked ? undefined : 0}
      onClick={locked ? undefined : () => onBeginEdit(field)}
      onKeyDown={
        locked
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onBeginEdit(field);
              }
            }
      }
    >
      <div className={styles.lbl}>{label}</div>
      <div className={`${styles.val} ${empty ? styles.valEmpty : ""}`}>{display}</div>
      {locked && (
        <span className={`${styles.act} ${styles.lock}`}>
          <Lock className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}

interface PicklistRowProps {
  label: string;
  field: string;
  locked: boolean;
  editingField: string | null;
  onBeginEdit: (field: string) => void;
  onCancel: () => void;
  /** Single-select: tapping a chip saves it right away (null = clear). */
  onPick?: (value: string | null) => void;
  /** Multi-select: saves the toggled set when the user taps outside the row. */
  onSave?: () => void;
  multi?: boolean;
  saving: boolean;
  saveErr: string;
  t: (key: string, fallback?: string) => string;
  value: string | string[] | null;
  labelFor: (value: string | null | undefined) => string;
  options: PicklistValue[];
  display: (o: PicklistValue) => string;
  chipDraft: string[];
  onToggleChip: (value: string) => void;
}

/** fixes88: tap the row to open the chips. Single-select saves on the tap
 *  of a chip (an explicit "נקה" clears — so an accidental tap never wipes a
 *  value); multi-select saves when you tap outside the row. Esc / tapping
 *  outside a single-select closes it unchanged. */
function PicklistRow({
  label,
  field,
  locked,
  editingField,
  onBeginEdit,
  onCancel,
  onPick,
  onSave,
  multi,
  saving,
  saveErr,
  t,
  value,
  labelFor,
  options,
  display,
  chipDraft,
  onToggleChip,
}: PicklistRowProps) {
  const isEditing = editingField === field;
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const hasValue = values.length > 0;
  const rowRef = useRef<HTMLDivElement>(null);
  // Latest callbacks for the document listeners below.
  const leaveRef = useRef<() => void>(() => {});
  leaveRef.current = multi ? () => onSave?.() : onCancel;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!isEditing) return;
    const onDown = (e: PointerEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) leaveRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isEditing]);

  if (isEditing) {
    return (
      <div ref={rowRef} className={styles.row}>
        <div className={styles.lbl}>{label}</div>
        <div className={styles.editbox}>
          {options.length === 0 ? (
            <div className={styles.muted}>{t("apt.no_options", "אין אפשרויות מוגדרות בשדה הזה.")}</div>
          ) : (
            <div className={styles.chips}>
              {options.map((o) => {
                const on = multi ? chipDraft.includes(o.value) : values.includes(o.value);
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={saving}
                    className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                    onClick={() => (multi ? onToggleChip(o.value) : onPick?.(o.value))}
                  >
                    {display(o)}
                  </button>
                );
              })}
              {!multi && hasValue && (
                <button
                  type="button"
                  disabled={saving}
                  className={doorStyles.clearChip}
                  onClick={() => onPick?.(null)}
                >
                  {t("street.clear_value", "נקה ערך")}
                </button>
              )}
            </div>
          )}
          {saving && <div className={doorStyles.savingHint}>{t("action.saving", "שומר…")}</div>}
          {saveErr && <div className={styles.editErr}>{saveErr}</div>}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`${styles.row} ${locked ? "" : doorStyles.editableRow}`}
      role={locked ? undefined : "button"}
      tabIndex={locked ? undefined : 0}
      onClick={locked ? undefined : () => onBeginEdit(field)}
      onKeyDown={
        locked
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onBeginEdit(field);
              }
            }
      }
    >
      <div className={styles.lbl}>{label}</div>
      <div className={`${styles.val} ${hasValue ? "" : styles.valEmpty}`}>
        {hasValue ? (
          <div className={styles.chips}>
            {values.map((v) => (
              <span key={v} className={`${styles.chip} ${styles.chipOn} ${styles.chipView}`}>
                {labelFor(v)}
              </span>
            ))}
          </div>
        ) : (
          "—"
        )}
      </div>
      {locked && (
        <span className={`${styles.act} ${styles.lock}`}>
          <Lock className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}
