"use client";

import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Lock, MapPin, Pencil } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import BuildingCelebration from "@/components/BuildingCelebration";
import { CustomFieldValueDisplay } from "@/components/CustomFieldValueInput";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { mapsHref } from "@/lib/contactActions";
import { useCustomFieldDefs } from "@/lib/customFields";
import { sortByFieldOrder, useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization, type Lang } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
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
  type CustomFieldDefinition,
  type PicklistField as PicklistFieldDef,
  type PicklistValue,
} from "@/lib/types";

import styles from "./street2.module.css";

/** docs/fixes70_street_v2.md: a card-based v2 of /dashboard/street (RULE 0 —
 *  that page and everything it imports stays untouched; this is a fully
 *  separate route/file). RULE 1: the data fetching, field set, picklists,
 *  labels, edit mutations and access rule below are copied from
 *  /dashboard/street/page.tsx on purpose — this is intentional duplication
 *  of presentation, not a fork of shared data code (there was none to reuse;
 *  street's fetch/edit logic lives inline in its own page component).
 *
 *  DESIGN CHOICE (undocumented gap in the spec): the current street page has
 *  no "done"/completion concept anywhere — no such field exists on Apartment
 *  and no such action exists in its UI. Rule 3's building-completion
 *  celebration needs one, so street2 adds a *local, client-side-only* done
 *  tracker (a checkbox per door, persisted to localStorage, keyed by user
 *  id) that never touches the backend. It's new game-layer state, not a
 *  reused "same mutation" — every other action on this page (editing a
 *  field) is wired to the exact same PUT /api/apartments/:id street uses. */

type TextField = "name" | "phone" | "email" | "apartment_notes";
type PicklistField = "jewish_status" | "campaign_status" | "mezuzah_status";

const TEXT_FIELD_LOCK_KEY: Record<TextField, string> = {
  name: "resident",
  phone: "phone",
  email: "email",
  apartment_notes: "notes",
};

interface BuildingGroup {
  id: number;
  name: string;
  address: string | null;
  area: string | null;
  apartments: ApartmentListItem[];
}

type PicklistHook = ReturnType<typeof usePicklist>;
type TFn = (key: string, fallback?: string) => string;

export default function Street2Page() {
  const { loading: authLoading, isShliach, user } = useAuth();
  const { t, lang } = useLocalization();

  const [items, setItems] = useState<ApartmentListItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [buildingIdx, setBuildingIdx] = useState(0);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [chipDraft, setChipDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const [celebration, setCelebration] = useState<{ open: boolean; label: string }>({
    open: false,
    label: "",
  });

  // See file-header note: street2-only local completion tracker, not backend
  // state. A fixed key (not scoped by user id — usePersistentState's lazy
  // initializer only runs once at mount, before `user` has loaded from the
  // token, so an id-based key was found live to silently wipe the previous
  // session's progress on every reload; matches this hook's existing
  // convention elsewhere in the app, e.g. "crm.sidebarCollapsed").
  const [doneMap, setDoneMap] = usePersistentState<Record<number, true>>(
    "crm.street2.done",
    {},
  );

  const jewish = usePicklist("apartment.Jewish_status");
  const campaign = usePicklist("apartment.campaign_status");
  const mezuzah = usePicklist("apartment.mezuzah_status");
  const language = usePicklist("apartment.language");

  const { isFieldVisible: vis, orderFor } = useFieldSettings();
  const [customDefs, setCustomDefs] = useState<PicklistFieldDef[]>([]);
  const customFieldDefs = useCustomFieldDefs("apartment").filter((d) => d.field_type !== "select");
  const { labelFor: customLabel } = usePicklistsMap(customDefs.map((d) => d.field_key));

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

  // fixes51 §4 / fixes54 §6: same org-wide "disable edit" + per-field "Edit
  // Lock" settings street.tsx honors.
  const shliachViewConfig = user?.organization?.shliach_view_config;
  const shliachEditDisabled = isShliach && !!shliachViewConfig?.disable_edit;
  const lockedFields = new Set(
    isShliach && Array.isArray(shliachViewConfig?.apartment_edit_locked_fields)
      ? (shliachViewConfig.apartment_edit_locked_fields as string[])
      : [],
  );
  const fieldLocked = (key: string) => shliachEditDisabled || lockedFields.has(key);

  async function load() {
    setBusy(true);
    setLoadError(false);
    try {
      const all: ApartmentListItem[] = [];
      let page = 1;
      let total = Infinity;
      while (all.length < total) {
        const res = await apiFetch<ApartmentPage>(
          `/api/apartments/list?page=${page}&page_size=100`,
        );
        total = res.total;
        all.push(...res.items);
        if (res.items.length === 0) break;
        page++;
      }
      setItems(all);
    } catch {
      setLoadError(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (authLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const buildings = useMemo<BuildingGroup[]>(() => {
    const map = new Map<number, BuildingGroup>();
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
    return Array.from(map.values());
  }, [items]);

  const totalBuildings = buildings.length;
  const currentIdx = Math.min(buildingIdx, Math.max(totalBuildings - 1, 0));
  const building = buildings[currentIdx] ?? null;

  const buildingsCompleted = buildings.filter((b) =>
    b.apartments.length > 0 && b.apartments.every((a) => doneMap[a.id]),
  ).length;
  const overallPct = totalBuildings ? Math.round((buildingsCompleted / totalBuildings) * 100) : 0;

  function goPrev() {
    setBuildingIdx((i) => Math.max(0, Math.min(i, totalBuildings - 1) - 1));
  }
  function goNext() {
    setBuildingIdx((i) => Math.min(totalBuildings - 1, Math.min(i, totalBuildings - 1) + 1));
  }

  function toggleDone(apt: ApartmentListItem, bld: BuildingGroup) {
    setDoneMap((prev) => {
      const next = { ...prev };
      if (prev[apt.id]) {
        delete next[apt.id];
      } else {
        next[apt.id] = true;
        // RULE 3: fire only when THIS action is what completes the building
        // — never on initial load / from data already marked done before.
        const wasAllDone = bld.apartments.every((a) => prev[a.id]);
        const isAllDoneNow = bld.apartments.every((a) => next[a.id]);
        if (!wasAllDone && isAllDoneNow) {
          setCelebration({ open: true, label: bld.name });
        }
      }
      return next;
    });
  }

  function beginEdit(apt: ApartmentListItem, field: string) {
    setSaveErr("");
    setEditingKey(`${apt.id}:${field}`);
    if (field === "name" || field === "phone" || field === "email" || field === "apartment_notes") {
      setTextDraft((apt[field as TextField] as string | null) ?? "");
    } else if (field === "language") {
      setChipDraft(apt.language ?? []);
    } else if (field === "jewish_status" || field === "campaign_status" || field === "mezuzah_status") {
      const v = apt[field as PicklistField];
      setChipDraft(v ? [v] : []);
    }
  }

  function cancelEdit() {
    setEditingKey(null);
    setSaveErr("");
  }

  function toggleChip(value: string, multi: boolean) {
    setChipDraft((prev) => {
      if (multi) {
        return prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      }
      return prev.includes(value) ? [] : [value];
    });
  }

  async function commitPatch(apt: ApartmentListItem, patch: Record<string, unknown>) {
    setSaving(true);
    setSaveErr("");
    try {
      // fixes19 §3: apartments are versioned — PUT returns a NEW row/id.
      // Merge it in place and carry any local "done" mark to the new id.
      const saved = await apiFetch<Apartment>(`/api/apartments/${apt.id}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      const merged: ApartmentListItem = { ...apt, ...saved };
      setItems((prev) => prev.map((it) => (it.id === apt.id ? merged : it)));
      if (merged.id !== apt.id) {
        setDoneMap((prev) => {
          if (!(apt.id in prev)) return prev;
          const next = { ...prev };
          delete next[apt.id];
          next[merged.id] = true;
          return next;
        });
      }
      setEditingKey(null);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setSaving(false);
    }
  }

  function saveText(apt: ApartmentListItem, field: TextField) {
    const v = textDraft.trim();
    if (field === "phone" && v !== "" && !isValidPhone(v)) {
      setSaveErr(t("validation.phone_hint", PHONE_HINT));
      return;
    }
    if (field === "email" && v !== "" && !isValidEmail(v)) {
      setSaveErr(t("validation.email_hint", EMAIL_HINT));
      return;
    }
    commitPatch(apt, { [field]: v === "" ? null : v });
  }

  function saveSinglePicklist(apt: ApartmentListItem, field: PicklistField) {
    commitPatch(apt, { [field]: chipDraft[0] ?? null });
  }

  function saveLanguage(apt: ApartmentListItem) {
    commitPatch(apt, { language: chipDraft });
  }

  if (authLoading) {
    return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  }

  return (
    <div dir="rtl" className={styles.pageBg}>
      <Link href="/dashboard/apartments" className={styles.backLink}>
        {t("page.back_to_apartments", "← חזרה לדירות")}
      </Link>

      <div className={styles.stickyHeader}>
        <div className={styles.title}>{t("street2.title", "המסלול שלי — גרסה 2")}</div>
        {totalBuildings > 0 && (
          <>
            <div className={styles.buildingNav}>
              <button
                type="button"
                className={styles.navBtn}
                onClick={goNext}
                disabled={currentIdx >= totalBuildings - 1}
              >
                {t("pager.next", "הבא ←")}
              </button>
              <div className={styles.buildingCounter}>
                {t("street2.building_x_of_y", "בניין {x} מתוך {y}")
                  .replace("{x}", String(currentIdx + 1))
                  .replace("{y}", String(totalBuildings))}
              </div>
              <button
                type="button"
                className={styles.navBtn}
                onClick={goPrev}
                disabled={currentIdx <= 0}
              >
                {t("pager.prev", "→ הקודם")}
              </button>
            </div>
            <div className={styles.routeBarTrack}>
              <div className={styles.routeBarFill} style={{ width: `${overallPct}%` }} />
              <span className={styles.routeWalker} style={{ insetInlineStart: `${overallPct}%` }}>
                🚶
              </span>
            </div>
            <div className={styles.routeBarLabel}>
              {t("street2.buildings_done_of_total", "{done} מתוך {total} בניינים הושלמו")
                .replace("{done}", String(buildingsCompleted))
                .replace("{total}", String(totalBuildings))}
            </div>
          </>
        )}
      </div>

      <div className={styles.wrap}>
        {busy ? (
          <div className={styles.state}>
            <div className={styles.spinner} />
            {t("action.loading", "טוען…")}
          </div>
        ) : loadError ? (
          <div className={styles.state}>
            <div className={styles.stateBig}>⚠️</div>
            <div>{t("apt.load_failed", "טעינת הדירות נכשלה. נסה שוב.")}</div>
            <button type="button" className={styles.retry} onClick={load}>
              {t("action.retry", "נסה שוב")}
            </button>
          </div>
        ) : !building ? (
          <div className={styles.state}>
            <div className={styles.stateBig}>🏠</div>
            <div>{t("apt.no_apartments_page", "אין דירות להצגה.")}</div>
          </div>
        ) : (
          <BuildingCard
            building={building}
            doneMap={doneMap}
            onToggleDone={(apt) => toggleDone(apt, building)}
            t={t}
            lang={lang}
            jewish={jewish}
            campaign={campaign}
            mezuzah={mezuzah}
            language={language}
            fieldLocked={fieldLocked}
            editingKey={editingKey}
            onBeginEdit={beginEdit}
            onCancelEdit={cancelEdit}
            textDraft={textDraft}
            setTextDraft={setTextDraft}
            chipDraft={chipDraft}
            onToggleChip={toggleChip}
            saving={saving}
            saveErr={saveErr}
            onSaveText={saveText}
            onSaveSinglePicklist={saveSinglePicklist}
            onSaveLanguage={saveLanguage}
            customDefs={customDefs}
            customFieldDefs={customFieldDefs}
            customLabel={customLabel}
            vis={vis}
            orderFor={orderFor}
          />
        )}

        {building && (
          <div className={styles.bottomNav}>
            <button
              type="button"
              className={styles.bottomNavBtn}
              onClick={goPrev}
              disabled={currentIdx <= 0}
            >
              <ChevronRight className="h-4 w-4" /> {t("pager.prev", "→ הקודם")}
            </button>
            <button
              type="button"
              className={styles.bottomNavBtn}
              onClick={goNext}
              disabled={currentIdx >= totalBuildings - 1}
            >
              {t("pager.next", "הבא ←")} <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <BuildingCelebration
        open={celebration.open}
        buildingLabel={celebration.label}
        onClose={() => setCelebration((c) => ({ ...c, open: false }))}
      />
    </div>
  );
}

interface BuildingCardProps {
  building: BuildingGroup;
  doneMap: Record<number, true>;
  onToggleDone: (apt: ApartmentListItem) => void;
  t: TFn;
  lang: Lang;
  jewish: PicklistHook;
  campaign: PicklistHook;
  mezuzah: PicklistHook;
  language: PicklistHook;
  fieldLocked: (key: string) => boolean;
  editingKey: string | null;
  onBeginEdit: (apt: ApartmentListItem, field: string) => void;
  onCancelEdit: () => void;
  textDraft: string;
  setTextDraft: (v: string) => void;
  chipDraft: string[];
  onToggleChip: (value: string, multi: boolean) => void;
  saving: boolean;
  saveErr: string;
  onSaveText: (apt: ApartmentListItem, field: TextField) => void;
  onSaveSinglePicklist: (apt: ApartmentListItem, field: PicklistField) => void;
  onSaveLanguage: (apt: ApartmentListItem) => void;
  customDefs: PicklistFieldDef[];
  customFieldDefs: CustomFieldDefinition[];
  customLabel: (fieldKey: string, value: string | null | undefined) => string;
  vis: (fieldKey: string) => boolean;
  orderFor: (fieldKey: string) => number | null;
}

/** One building — header, per-building route progress, and its doors as
 *  stacked DOOR CARDS (RULE 2). */
function BuildingCard(props: BuildingCardProps) {
  const { building: b, doneMap, t } = props;
  const doneCount = b.apartments.filter((a) => doneMap[a.id]).length;
  const total = b.apartments.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className={styles.buildingCard}>
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

      <div className={styles.bProgress}>
        <div className={styles.bProgressTrack}>
          <div className={styles.bProgressFill} style={{ width: `${pct}%` }} />
        </div>
        <div className={styles.bProgressLabel}>
          {t("street2.apartments_done_of_total", "{done} מתוך {total} דירות")
            .replace("{done}", String(doneCount))
            .replace("{total}", String(total))}
        </div>
      </div>

      <div className={styles.doorList}>
        {b.apartments.map((a) => (
          <DoorCard key={a.id} apt={a} done={!!doneMap[a.id]} {...props} />
        ))}
      </div>
    </div>
  );
}

interface DoorCardProps extends Omit<BuildingCardProps, "building" | "doneMap" | "onToggleDone"> {
  apt: ApartmentListItem;
  done: boolean;
  onToggleDone: (apt: ApartmentListItem) => void;
}

/** One door — apartment number + every visible field (RULE 1), the same
 *  tap-pencil-to-edit actions street.tsx offers, plus the new mark-done
 *  toggle (RULE 2/3). */
function DoorCard({
  apt: a,
  done,
  onToggleDone,
  t,
  lang,
  jewish,
  campaign,
  mezuzah,
  language,
  fieldLocked,
  editingKey,
  onBeginEdit,
  onCancelEdit,
  textDraft,
  setTextDraft,
  chipDraft,
  onToggleChip,
  saving,
  saveErr,
  onSaveText,
  onSaveSinglePicklist,
  onSaveLanguage,
  customDefs,
  customFieldDefs,
  customLabel,
  vis,
  orderFor,
}: DoorCardProps) {
  const editingField =
    editingKey && editingKey.startsWith(`${a.id}:`) ? editingKey.slice(String(a.id).length + 1) : null;

  // Recomputed every render (no memo) — cheap, and matches street.tsx's own
  // inline IIFE: memoizing here previously risked going stale the moment
  // `vis`/`customLabel` change identity (field settings finish loading)
  // without `a`/customDefs/customFieldDefs/lang also changing.
  type Extra = { key: string; label: string; node: ReactNode };
  const extrasList: Extra[] = [
    ...customDefs
      .filter((d) => vis(d.field_key))
      .map((d): Extra => ({
        key: d.field_key,
        label: (lang === "en" ? d.english_label || d.label : d.label) || d.field_key,
        node: customLabel(d.field_key, a.picklist_values?.[d.field_key]) || "—",
      })),
    ...customFieldDefs
      .filter((d) => vis(`customfield.apartment.${d.field_key}`))
      .map((d): Extra => ({
        key: `customfield.apartment.${d.field_key}`,
        label: (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) || d.field_key,
        node: (
          <CustomFieldValueDisplay
            fieldType={d.field_type}
            value={a.custom_field_values?.[d.field_key] ?? null}
          />
        ),
      })),
  ];
  const extras = sortByFieldOrder(extrasList, (e) => e.key, orderFor);

  return (
    <div className={`${styles.doorCard} ${done ? styles.doorCardDone : ""}`}>
      <div className={styles.dHead}>
        <div className={styles.dTitle}>{apartmentTitle(a)}</div>
        {a.jewish_status && (
          <span className={styles.dStatusChip}>{jewish.labelFor(a.jewish_status)}</span>
        )}
        <button
          type="button"
          className={`${styles.doneBtn} ${done ? styles.doneBtnOn : ""}`}
          onClick={() => onToggleDone(a)}
        >
          <Check className="h-4 w-4" />
          {done ? t("street2.done_label", "בוצע") : t("street2.mark_done", "סמן כבוצע")}
        </button>
      </div>

      <div className={styles.rows}>
        <EditableRow
          label={t("apartments.name", "שם דייר")}
          field="name"
          locked={fieldLocked(TEXT_FIELD_LOCK_KEY.name)}
          isEditing={editingField === "name"}
          onBeginEdit={() => onBeginEdit(a, "name")}
          onCancel={onCancelEdit}
          onSave={() => onSaveText(a, "name")}
          saving={saving}
          saveErr={saveErr}
          t={t}
          display={a.name || "—"}
          empty={!a.name}
          editor={<input type="text" value={textDraft} onChange={(e) => setTextDraft(e.target.value)} />}
        />
        <EditableRow
          label={t("apartments.phone", "טלפון")}
          field="phone"
          locked={fieldLocked(TEXT_FIELD_LOCK_KEY.phone)}
          isEditing={editingField === "phone"}
          onBeginEdit={() => onBeginEdit(a, "phone")}
          onCancel={onCancelEdit}
          onSave={() => onSaveText(a, "phone")}
          saving={saving}
          saveErr={saveErr}
          t={t}
          display={
            a.phone ? (
              <a href={`tel:${a.phone}`} dir="ltr" className={styles.rowLink}>
                {a.phone}
              </a>
            ) : (
              "—"
            )
          }
          empty={!a.phone}
          editor={
            <input type="tel" dir="ltr" value={textDraft} onChange={(e) => setTextDraft(e.target.value)} />
          }
        />
        <EditableRow
          label={t("apartments.email", "אימייל")}
          field="email"
          locked={fieldLocked(TEXT_FIELD_LOCK_KEY.email)}
          isEditing={editingField === "email"}
          onBeginEdit={() => onBeginEdit(a, "email")}
          onCancel={onCancelEdit}
          onSave={() => onSaveText(a, "email")}
          saving={saving}
          saveErr={saveErr}
          t={t}
          display={
            a.email ? (
              <a href={`mailto:${a.email}`} dir="ltr" className={styles.rowLink}>
                {a.email}
              </a>
            ) : (
              "—"
            )
          }
          empty={!a.email}
          editor={
            <input type="email" dir="ltr" value={textDraft} onChange={(e) => setTextDraft(e.target.value)} />
          }
        />

        <PicklistRow
          label={t("picklist.apartment.Jewish_status", "יהדות")}
          field="jewish_status"
          locked={fieldLocked("jewish_status")}
          isEditing={editingField === "jewish_status"}
          onBeginEdit={() => onBeginEdit(a, "jewish_status")}
          onCancel={onCancelEdit}
          onSave={() => onSaveSinglePicklist(a, "jewish_status")}
          saving={saving}
          saveErr={saveErr}
          t={t}
          value={a.jewish_status}
          labelFor={jewish.labelFor}
          options={jewish.options}
          display={jewish.display}
          chipDraft={chipDraft}
          onToggleChip={(v) => onToggleChip(v, false)}
        />
        <PicklistRow
          label={t("picklist.apartment.campaign_status", "סטטוס קמפיין")}
          field="campaign_status"
          locked={fieldLocked("campaign_status")}
          isEditing={editingField === "campaign_status"}
          onBeginEdit={() => onBeginEdit(a, "campaign_status")}
          onCancel={onCancelEdit}
          onSave={() => onSaveSinglePicklist(a, "campaign_status")}
          saving={saving}
          saveErr={saveErr}
          t={t}
          value={a.campaign_status}
          labelFor={campaign.labelFor}
          options={campaign.options}
          display={campaign.display}
          chipDraft={chipDraft}
          onToggleChip={(v) => onToggleChip(v, false)}
        />
        <PicklistRow
          label={t("picklist.apartment.mezuzah_status", "מזוזה")}
          field="mezuzah_status"
          locked={fieldLocked("mezuzah_status")}
          isEditing={editingField === "mezuzah_status"}
          onBeginEdit={() => onBeginEdit(a, "mezuzah_status")}
          onCancel={onCancelEdit}
          onSave={() => onSaveSinglePicklist(a, "mezuzah_status")}
          saving={saving}
          saveErr={saveErr}
          t={t}
          value={a.mezuzah_status}
          labelFor={mezuzah.labelFor}
          options={mezuzah.options}
          display={mezuzah.display}
          chipDraft={chipDraft}
          onToggleChip={(v) => onToggleChip(v, false)}
        />
        <PicklistRow
          label={t("picklist.apartment.language", "שפה")}
          field="language"
          locked={fieldLocked("language")}
          isEditing={editingField === "language"}
          onBeginEdit={() => onBeginEdit(a, "language")}
          onCancel={onCancelEdit}
          onSave={() => onSaveLanguage(a)}
          saving={saving}
          saveErr={saveErr}
          t={t}
          value={a.language}
          labelFor={language.labelFor}
          options={language.options}
          display={language.display}
          chipDraft={chipDraft}
          onToggleChip={(v) => onToggleChip(v, true)}
        />

        <div className={styles.row}>
          <div className={styles.lbl}>{t("apartments.report_number_id", "מספר דוח")}</div>
          <div className={`${styles.val} ${a.report_number_name ? "" : styles.valEmpty}`}>
            {a.report_number_name || "—"}
          </div>
          <span className={`${styles.act} ${styles.lock}`}>
            <Lock className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className={`${styles.row} ${styles.rowTop}`}>
          <div className={styles.lbl}>{t("apartments.apartment_notes", "הערות")}</div>
          {editingField === "apartment_notes" ? (
            <div className={styles.editbox}>
              <textarea value={textDraft} onChange={(e) => setTextDraft(e.target.value)} />
              <div className={styles.editActions}>
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={saving}
                  onClick={() => onSaveText(a, "apartment_notes")}
                >
                  {t("action.save", "שמור")}
                </button>
                <button type="button" className={styles.cancelBtn} disabled={saving} onClick={onCancelEdit}>
                  {t("action.cancel", "ביטול")}
                </button>
              </div>
              {saveErr && <div className={styles.editErr}>{saveErr}</div>}
            </div>
          ) : (
            <>
              <div className={`${styles.notesCard} ${styles.val} ${a.apartment_notes ? "" : styles.valEmpty}`}>
                {a.apartment_notes || "—"}
              </div>
              {!fieldLocked(TEXT_FIELD_LOCK_KEY.apartment_notes) && (
                <button
                  type="button"
                  className={styles.act}
                  onClick={() => onBeginEdit(a, "apartment_notes")}
                  title={t("action.edit", "ערוך")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        <div className={styles.row}>
          <div className={styles.lbl}>{t("apt.contact", "איש קשר")}</div>
          <div className={`${styles.val} ${a.contact_name ? "" : styles.valEmpty}`}>
            {a.contact_id && a.contact_name ? (
              <Link href={`/dashboard/contacts/${a.contact_id}`} className={styles.rowLink}>
                {a.contact_name}
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

      {extras.length > 0 && (
        <div className={styles.section}>
          <h3>{t("street.extra_fields", "שדות נוספים")}</h3>
          {extras.map((e) => (
            <div key={e.key} className={styles.roExtra}>
              <b>{e.label}:</b> {e.node}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface EditableRowProps {
  label: string;
  field: string;
  locked: boolean;
  isEditing: boolean;
  onBeginEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveErr: string;
  t: TFn;
  display: ReactNode;
  empty: boolean;
  editor: ReactNode;
}

function EditableRow({
  label,
  locked,
  isEditing,
  onBeginEdit,
  onCancel,
  onSave,
  saving,
  saveErr,
  t,
  display,
  empty,
  editor,
}: EditableRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.lbl}>{label}</div>
      {isEditing ? (
        <div className={styles.editbox}>
          {editor}
          <div className={styles.editActions}>
            <button type="button" className={styles.saveBtn} disabled={saving} onClick={onSave}>
              {t("action.save", "שמור")}
            </button>
            <button type="button" className={styles.cancelBtn} disabled={saving} onClick={onCancel}>
              {t("action.cancel", "ביטול")}
            </button>
          </div>
          {saveErr && <div className={styles.editErr}>{saveErr}</div>}
        </div>
      ) : (
        <>
          <div className={`${styles.val} ${empty ? styles.valEmpty : ""}`}>{display}</div>
          {locked ? (
            <span className={`${styles.act} ${styles.lock}`}>
              <Lock className="h-3.5 w-3.5" />
            </span>
          ) : (
            <button type="button" className={styles.act} onClick={onBeginEdit} title={t("action.edit", "ערוך")}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

interface PicklistRowProps {
  label: string;
  field: string;
  locked: boolean;
  isEditing: boolean;
  onBeginEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveErr: string;
  t: TFn;
  value: string | string[] | null;
  labelFor: (value: string | null | undefined) => string;
  options: PicklistValue[];
  display: (o: PicklistValue) => string;
  chipDraft: string[];
  onToggleChip: (value: string) => void;
}

function PicklistRow({
  label,
  locked,
  isEditing,
  onBeginEdit,
  onCancel,
  onSave,
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
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const hasValue = values.length > 0;
  return (
    <div className={styles.row}>
      <div className={styles.lbl}>{label}</div>
      {isEditing ? (
        <div className={styles.editbox}>
          {options.length === 0 ? (
            <div className={styles.roExtra}>{t("apt.no_options", "אין אפשרויות מוגדרות בשדה הזה.")}</div>
          ) : (
            <div className={styles.chips}>
              {options.map((o) => {
                const on = chipDraft.includes(o.value);
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                    onClick={() => onToggleChip(o.value)}
                  >
                    {display(o)}
                  </button>
                );
              })}
            </div>
          )}
          <div className={styles.editActions}>
            <button type="button" className={styles.saveBtn} disabled={saving} onClick={onSave}>
              {t("action.save", "שמור")}
            </button>
            <button type="button" className={styles.cancelBtn} disabled={saving} onClick={onCancel}>
              {t("action.cancel", "ביטול")}
            </button>
          </div>
          {saveErr && <div className={styles.editErr}>{saveErr}</div>}
        </div>
      ) : (
        <>
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
          {locked ? (
            <span className={`${styles.act} ${styles.lock}`}>
              <Lock className="h-3.5 w-3.5" />
            </span>
          ) : (
            <button type="button" className={styles.act} onClick={onBeginEdit} title={t("action.edit", "ערוך")}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
