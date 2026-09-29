"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, MapPin, Pencil } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import BuildingCelebration from "@/components/BuildingCelebration";
import { CustomFieldValueDisplay } from "@/components/CustomFieldValueInput";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useActiveCampaignFieldVisibility } from "@/lib/campaignFieldVisibility";
import { mapsHref } from "@/lib/contactActions";
import { useCustomFieldDefs } from "@/lib/customFields";
import { sortByFieldOrder, useFieldSettings } from "@/lib/fieldSettings";
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
  type PicklistField as PicklistFieldDef,
  type PicklistValue,
} from "@/lib/types";

// Reused as-is (RULE 0/1, docs/fixes70_street_v2.md): street2 must look and
// behave like /dashboard/street, so it imports street's own CSS module
// instead of a hand-maintained near-duplicate — this is a read-only import
// (a new consumer of the file), not a modification of street or its files.
import styles from "../street/street.module.css";

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
 *  Admins get redirected to /dashboard/apartments before the fetch ever
 *  starts (this page's real dataset can be the WHOLE org for an admin,
 *  which is what produced the "endless spinner" — street.tsx has no such
 *  guard, but the requirement here was explicit: admins must not hit it). */

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
  const router = useRouter();
  const { loading: authLoading, isAdmin, isShliach, user } = useAuth();
  const { t, lang } = useLocalization();

  const [items, setItems] = useState<ApartmentListItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [openId, setOpenId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [chipDraft, setChipDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const [celebration, setCelebration] = useState<{ open: boolean; label: string }>({
    open: false,
    label: "",
  });

  // Admins must never land on this page (it can be a whole-org fetch for
  // them) — bounce to the real admin apartments view before load() ever runs.
  useEffect(() => {
    if (!authLoading && isAdmin) {
      router.replace("/dashboard/apartments");
    }
  }, [authLoading, isAdmin, router]);

  const jewish = usePicklist("apartment.Jewish_status");
  const campaign = usePicklist("apartment.campaign_status");
  const mezuzah = usePicklist("apartment.mezuzah_status");
  const language = usePicklist("apartment.language");

  // fixes71 §C.5: ordering stays global (untouched); visibility now comes
  // from the active campaign, not this hook's isFieldVisible.
  const { orderFor } = useFieldSettings();
  const { isVisible: campaignVisible } = useActiveCampaignFieldVisibility();
  const [customDefs, setCustomDefs] = useState<PicklistFieldDef[]>([]);
  const customFieldDefs = useCustomFieldDefs("apartment").filter(
    (d) => d.field_type !== "select" && d.field_key !== TO_KNOCK_CUSTOM_FIELD_KEY,
  );
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
    if (authLoading || isAdmin) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAdmin]);

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
    return Array.from(map.values());
  }, [items]);

  const openApt = items.find((a) => a.id === openId) ?? null;

  function beginEdit(field: string) {
    if (!openApt) return;
    setSaveErr("");
    setEditingField(field);
    if (field === "name" || field === "phone" || field === "email" || field === "apartment_notes") {
      setTextDraft((openApt[field as TextField] as string | null) ?? "");
    } else if (field === "language") {
      setChipDraft(openApt.language ?? []);
    } else if (field === "jewish_status" || field === "campaign_status" || field === "mezuzah_status") {
      const v = openApt[field as PicklistField];
      setChipDraft(v ? [v] : []);
    }
  }

  function toggleChip(value: string, multi: boolean) {
    setChipDraft((prev) => {
      if (multi) {
        return prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      }
      return prev.includes(value) ? [] : [value];
    });
  }

  async function commitPatch(patch: Record<string, unknown>) {
    if (!openApt) return;
    const buildingId = openApt.building_id;
    // fixes71 §C.4: building-level before/after (not a single-apartment
    // "was this door done" flag) — correctly avoids a refire if a
    // *non*-to-knock door is edited after the building's real to-knock
    // doors were already all done.
    const wasComplete = buildingComplete(items.filter((a) => a.building_id === buildingId));
    setSaving(true);
    setSaveErr("");
    try {
      // fixes19 §3: apartments are versioned — a PUT returns a NEW row with a
      // new id (and, as a side effect, a non-null root_id — see file header).
      const saved = await apiFetch<Apartment>(`/api/apartments/${openApt.id}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      const merged: ApartmentListItem = { ...openApt, ...saved };
      setItems((prev) => {
        const next = prev.map((it) => (it.id === openApt.id ? merged : it));
        // RULE 3: fire only when THIS save is what completes the building —
        // never on initial load, never re-firing for an already-complete one.
        if (!wasComplete && buildingComplete(next.filter((a) => a.building_id === buildingId))) {
          setCelebration({ open: true, label: buildingDisplayName({
            id: buildingId,
            building_name: merged.building_name,
            building_address: merged.building_address,
          }) });
        }
        return next;
      });
      setOpenId(merged.id);
      setEditingField(null);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setSaving(false);
    }
  }

  function saveText(field: TextField) {
    const v = textDraft.trim();
    if (field === "phone" && v !== "" && !isValidPhone(v)) {
      setSaveErr(t("validation.phone_hint", PHONE_HINT));
      return;
    }
    if (field === "email" && v !== "" && !isValidEmail(v)) {
      setSaveErr(t("validation.email_hint", EMAIL_HINT));
      return;
    }
    commitPatch({ [field]: v === "" ? null : v });
  }

  function saveSinglePicklist(field: PicklistField) {
    commitPatch({ [field]: chipDraft[0] ?? null });
  }

  function saveLanguage() {
    commitPatch({ language: chipDraft });
  }

  if (authLoading || isAdmin) {
    return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  }

  const buildingCountFor = (buildingId: number) =>
    items.filter((a) => a.building_id === buildingId).length;

  return (
    <div className={styles.pageBg}>
      <Link href="/dashboard/apartments" className={styles.backLink}>
        {t("page.back_to_apartments", "← חזרה לדירות")}
      </Link>
      <div className={styles.wrap}>
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
              <div className={styles.doors}>
                {b.apartments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={styles.door}
                    onClick={() => setOpenId(a.id)}
                  >
                    <span className={styles.knob} />
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
                ))}
              </div>
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
              {campaignVisible(FIELD_KEY.name) && (
                <EditableRow
                  label={t("apartments.name", "שם דייר")}
                  field="name"
                  locked={fieldLocked(TEXT_FIELD_LOCK_KEY.name)}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => setEditingField(null)}
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
              )}
              {campaignVisible(FIELD_KEY.phone) && (
                <EditableRow
                  label={t("apartments.phone", "טלפון")}
                  field="phone"
                  locked={fieldLocked(TEXT_FIELD_LOCK_KEY.phone)}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => setEditingField(null)}
                  onSave={() => saveText("phone")}
                  saving={saving}
                  saveErr={saveErr}
                  t={t}
                  display={
                    openApt.phone ? (
                      <a href={`tel:${openApt.phone}`} dir="ltr" className={styles.rowLink}>
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
              )}
              {campaignVisible(FIELD_KEY.email) && (
                <EditableRow
                  label={t("apartments.email", "אימייל")}
                  field="email"
                  locked={fieldLocked(TEXT_FIELD_LOCK_KEY.email)}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => setEditingField(null)}
                  onSave={() => saveText("email")}
                  saving={saving}
                  saveErr={saveErr}
                  t={t}
                  display={
                    openApt.email ? (
                      <a href={`mailto:${openApt.email}`} dir="ltr" className={styles.rowLink}>
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
              )}

              {campaignVisible(FIELD_KEY.jewish_status) && (
                <PicklistRow
                  label={t("picklist.apartment.Jewish_status", "יהדות")}
                  field="jewish_status"
                  locked={fieldLocked("jewish_status")}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => setEditingField(null)}
                  onSave={() => saveSinglePicklist("jewish_status")}
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
              )}
              {campaignVisible(FIELD_KEY.campaign_status) && (
                <PicklistRow
                  label={t("picklist.apartment.campaign_status", "סטטוס קמפיין")}
                  field="campaign_status"
                  locked={fieldLocked("campaign_status")}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => setEditingField(null)}
                  onSave={() => saveSinglePicklist("campaign_status")}
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
              )}
              {campaignVisible(FIELD_KEY.mezuzah_status) && (
                <PicklistRow
                  label={t("picklist.apartment.mezuzah_status", "מזוזה")}
                  field="mezuzah_status"
                  locked={fieldLocked("mezuzah_status")}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => setEditingField(null)}
                  onSave={() => saveSinglePicklist("mezuzah_status")}
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
              )}
              {campaignVisible(FIELD_KEY.language) && (
                <PicklistRow
                  label={t("picklist.apartment.language", "שפה")}
                  field="language"
                  locked={fieldLocked("language")}
                  editingField={editingField}
                  onBeginEdit={beginEdit}
                  onCancel={() => setEditingField(null)}
                  onSave={saveLanguage}
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
              )}

              {campaignVisible(FIELD_KEY.report_number_id) && (
                <div className={styles.row}>
                  <div className={styles.lbl}>{t("apartments.report_number_id", "מספר דוח")}</div>
                  <div className={`${styles.val} ${openApt.report_number_name ? "" : styles.valEmpty}`}>
                    {openApt.report_number_name || "—"}
                  </div>
                  <span className={`${styles.act} ${styles.lock}`}>
                    <Lock className="h-3.5 w-3.5" />
                  </span>
                </div>
              )}

              {campaignVisible(FIELD_KEY.apartment_notes) && (
                <div className={`${styles.row} ${styles.rowTop}`}>
                  <div className={styles.lbl}>{t("apartments.apartment_notes", "הערות")}</div>
                  {editingField === "apartment_notes" ? (
                    <div className={styles.editbox}>
                      <textarea
                        value={textDraft}
                        onChange={(e) => setTextDraft(e.target.value)}
                      />
                      <div className={styles.editActions}>
                        <button
                          type="button"
                          className={styles.saveBtn}
                          disabled={saving}
                          onClick={() => saveText("apartment_notes")}
                        >
                          {t("action.save", "שמור")}
                        </button>
                        <button
                          type="button"
                          className={styles.cancelBtn}
                          disabled={saving}
                          onClick={() => setEditingField(null)}
                        >
                          {t("action.cancel", "ביטול")}
                        </button>
                      </div>
                      {saveErr && <div className={styles.editErr}>{saveErr}</div>}
                    </div>
                  ) : (
                    <>
                      <div
                        className={`${styles.notesCard} ${styles.val} ${
                          openApt.apartment_notes ? "" : styles.valEmpty
                        }`}
                      >
                        {openApt.apartment_notes || "—"}
                      </div>
                      {!fieldLocked(TEXT_FIELD_LOCK_KEY.apartment_notes) && (
                        <button
                          type="button"
                          className={styles.act}
                          onClick={() => beginEdit("apartment_notes")}
                          title={t("action.edit", "ערוך")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* fixes71 §C.5/§C.6: every remaining apartment field (custom
                  picklists + custom fields, to_knock hard-excluded) as plain
                  read-only rows in this SAME list — no more separate "Extra
                  fields" section/heading. */}
              {sortByFieldOrder(
                [
                  ...customDefs
                    .filter((d) => campaignVisible(d.field_key))
                    .map((d) => ({
                      key: d.field_key,
                      label: (lang === "en" ? d.english_label || d.label : d.label) || d.field_key,
                      node: customLabel(d.field_key, openApt.picklist_values?.[d.field_key]) || "—",
                    })),
                  ...customFieldDefs
                    .filter((d) => campaignVisible(`customfield.apartment.${d.field_key}`))
                    .map((d) => ({
                      key: `customfield.apartment.${d.field_key}`,
                      label:
                        (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                        d.field_key,
                      node: (
                        <CustomFieldValueDisplay
                          fieldType={d.field_type}
                          value={openApt.custom_field_values?.[d.field_key] ?? null}
                        />
                      ),
                    })),
                ],
                (e) => e.key,
                orderFor,
              ).map((e) => (
                <div key={e.key} className={styles.row}>
                  <div className={styles.lbl}>{e.label}</div>
                  <div className={styles.val}>{e.node}</div>
                  <span className={`${styles.act} ${styles.lock}`}>
                    <Lock className="h-3.5 w-3.5" />
                  </span>
                </div>
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

      <BuildingCelebration
        open={celebration.open}
        buildingLabel={celebration.label}
        onClose={() => setCelebration((c) => ({ ...c, open: false }))}
      />
    </div>
  );
}

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
}

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
}: EditableRowProps) {
  const isEditing = editingField === field;
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
            <button
              type="button"
              className={styles.act}
              onClick={() => onBeginEdit(field)}
              title={t("action.edit", "ערוך")}
            >
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
  editingField: string | null;
  onBeginEdit: (field: string) => void;
  onCancel: () => void;
  onSave: () => void;
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

function PicklistRow({
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
  return (
    <div className={styles.row}>
      <div className={styles.lbl}>{label}</div>
      {isEditing ? (
        <div className={styles.editbox}>
          {options.length === 0 ? (
            <div className={styles.muted}>{t("apt.no_options", "אין אפשרויות מוגדרות בשדה הזה.")}</div>
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
            <button
              type="button"
              className={styles.act}
              onClick={() => onBeginEdit(field)}
              title={t("action.edit", "ערוך")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
