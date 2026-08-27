"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { ConfirmModal } from "@/components/ConfirmModal";
import { CustomFieldValueDisplay, CustomFieldValueInput } from "@/components/CustomFieldValueInput";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { PicklistSelect } from "@/components/PicklistSelect";
import { SearchableSelect } from "@/components/SearchableSelect";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { MultiSelectEditor } from "@/components/ui/MultiSelectEditor";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { mapsHref } from "@/lib/contactActions";
import { useCustomFieldDefs } from "@/lib/customFields";
import { sortByFieldOrder, useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import {
  FIXED_APARTMENT_PICKLIST_KEYS,
  usePicklist,
  usePicklistsMap,
} from "@/lib/picklists";
import { useToast } from "@/lib/toast";
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
  type ApartmentVersion,
  type Building,
  type Floor,
  type PicklistField,
  type ReportNumber,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/** Apartment card (fixes30 §2): the fields edit in place, Google-style — the
 *  same InlineEdit flow as the contact page (fixes26 §2). Every save is a
 *  fixes19 §3 versioned edit, so the page follows the new active id. */
export default function ApartmentDetailPage() {
  const router = useRouter();
  const { loading, isAdmin, isShliach, user } = useAuth();
  // fixes51 §4: org-wide "disable edit" for the Shliach role.
  const shliachEditDisabled =
    isShliach && !!user?.organization?.shliach_view_config?.disable_edit;
  const { t, lang } = useLocalization();
  const { isFieldVisible: vis, orderFor } = useFieldSettings();
  const { success } = useToast();
  const params = useParams<{ id: string }>();
  const apartmentId = Number(params.id);

  const [apt, setApt] = useState<Apartment | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [linked, setLinked] = useState<{ id: number; name: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  // fixes19: report-number name + admin edit history (previous versions).
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  const [history, setHistory] = useState<ApartmentVersion[]>([]);
  const [snapshot, setSnapshot] = useState<ApartmentVersion | null>(null);
  // fixes30 §2: option sources for the inline selects — the building's floors
  // and the org's buildings (same feeds as ApartmentEditor).
  const [floors, setFloors] = useState<Floor[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  // fixes34 §2.1: any admin-added apartment.* picklist beyond the fixed 4 —
  // same mechanism as the apartments list grid / ApartmentEditor, so a
  // custom picklist shows up here too with no further code changes.
  const [customDefs, setCustomDefs] = useState<PicklistField[]>([]);
  // fixes35: any non-select apartment custom field.
  const customFieldDefs = useCustomFieldDefs("apartment").filter((d) => d.field_type !== "select");

  const { labelFor: jewishLabel } = usePicklist("apartment.Jewish_status");
  const { labelFor: campaignLabel } = usePicklist("apartment.campaign_status");
  const { labelFor: mezuzahLabel } = usePicklist("apartment.mezuzah_status");
  // fixes51 §2.2: multi-select — the full picklist object (not just labelFor)
  // so the inline editor has its option list too.
  const languagePicklist = usePicklist("apartment.language");
  const languageLabel = languagePicklist.labelFor;
  const { labelFor: customLabel } = usePicklistsMap(
    customDefs.map((d) => d.field_key),
  );

  // fixes52 (perf): the org-wide buildings list (thousands of rows once a
  // building-heavy import has run — see docs/apartment_data_import.md) is
  // only needed for the rarely-used "move to a different building" picker
  // below, so it's fetched lazily on first open instead of on every page
  // load — see loadBuildingsIfNeeded, wired to that InlineEdit's `onOpen`.
  const [buildingsLoaded, setBuildingsLoaded] = useState(false);
  async function loadBuildingsIfNeeded() {
    if (buildingsLoaded) return;
    setBuildingsLoaded(true);
    setBuildings(await apiFetch<Building[]>("/api/buildings").catch(() => []));
  }

  async function reload() {
    const a = await apiFetch<Apartment>(`/api/apartments/${apartmentId}`);
    setApt(a);
    // fixes52 (perf): these five requests don't depend on each other, only
    // on `a` above — running them in parallel instead of one-after-another
    // cuts total wait time from the sum of every round-trip to roughly the
    // slowest single one.
    const [buildingResult, floorsResult, picklistDefs, enriched, reportNumbersResult, historyResult] =
      await Promise.all([
        apiFetch<Building>(`/api/buildings/${a.building_id}`).catch(() => null),
        apiFetch<Floor[]>(`/api/buildings/${a.building_id}/floors`).catch(() => []),
        apiFetch<PicklistField[]>("/api/picklists").catch(() => []),
        // The linked contact comes from the enriched list (shliach-scoped
        // too); apartment_id fetches just this row instead of the whole
        // building (fixes8).
        apiFetch<ApartmentPage>(
          `/api/apartments/list?apartment_id=${apartmentId}`,
        ).catch(() => null),
        apiFetch<ReportNumber[]>("/api/report-numbers").catch(() => []),
        isAdmin
          ? apiFetch<ApartmentVersion[]>(
              `/api/apartments/${apartmentId}/history`,
            ).catch(() => [])
          : Promise.resolve<ApartmentVersion[]>([]),
      ]);
    setBuilding(buildingResult);
    setFloors(floorsResult);
    setCustomDefs(
      picklistDefs.filter(
        (d) =>
          d.entity_type === "apartment" &&
          !FIXED_APARTMENT_PICKLIST_KEYS.includes(d.field_key),
      ),
    );
    const row = enriched?.items[0];
    setLinked(
      row?.contact_id ? { id: row.contact_id, name: row.contact_name ?? "" } : null,
    );
    setReportNumbers(reportNumbersResult);
    setHistory(historyResult);
  }

  useEffect(() => {
    if (loading) return;
    reload()
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("msg.load_failed", "טעינה נכשלה")),
      )
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apartmentId, loading]);

  // Confirmation runs through the localized ConfirmModal (fixes12 §3.1).
  async function remove() {
    if (!apt) return;
    setConfirmingDelete(false);
    await apiFetch(`/api/apartments/${apt.id}`, { method: "DELETE" });
    success(t("msg.deleted", "נמחק בהצלחה"));
    router.push("/dashboard/apartments");
  }

  // fixes22 §2: roll one field back to the selected historical version. The
  // restore is itself a versioned edit → a new active apartment id, so follow it.
  async function restoreField(fieldKey: string) {
    if (!snapshot) return;
    const updated = await apiFetch<Apartment>(
      `/api/apartments/${apartmentId}/restore-field`,
      {
        method: "POST",
        body: JSON.stringify({ version_id: snapshot.id, field: fieldKey }),
      },
    );
    success(t("apt.field_restored", "השדה שוחזר"));
    router.push(`/dashboard/apartments/${updated.id}`);
  }

  // fixes30 §2: one-field partial save (InlineEdit). Every PUT is a fixes19 §3
  // versioned edit returning a NEW active row — keep the UI on it and move the
  // URL along (the old id turns historical, which 404s for non-admins).
  async function patch(partial: Record<string, unknown>) {
    if (!apt) return;
    const saved = await apiFetch<Apartment>(`/api/apartments/${apt.id}`, {
      method: "PUT",
      body: JSON.stringify(partial),
    });
    setApt(saved);
    if (saved.id !== apartmentId) {
      router.replace(`/dashboard/apartments/${saved.id}`);
    }
  }

  if (loading || !loaded) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (error || !apt) {
    return (
      <div className="space-y-3">
        <Link href="/dashboard/apartments" className="text-sm text-status-magenta hover:underline">
          {t("page.back_to_apartments", "← חזרה לדירות")}
        </Link>
        <p className="text-status-darkred">
          {error || t("page.apartment_not_found", "הדירה לא נמצאה.")}
        </p>
      </div>
    );
  }

  // fixes30 §2: a visible field row whose value edits in place. Text fields
  // save trimmed-or-null partials; select editors commit on selection
  // (clicking away cancels), mirroring the contact page (fixes26 §2).
  // Historical versions (admin-viewable, fixes19 §3) are immutable — their
  // fields render as plain values.
  const editable = apt.is_display !== false;
  // fixes40 round 2 §4B: every toggleable field collects into a sorted array
  // (by its dashboard/fields order) instead of rendering inline — building
  // and building_address stay at their fixed positions (they're structural
  // anchors, never toggleable, so never orderable either — same boundary
  // the label-styling round drew for "not literally every field").
  type FieldEntry = { key: string; label: string; node: ReactNode; span2?: boolean };
  const field = (
    key: string,
    labelKey: string,
    fallback: string,
    node: ReactNode,
    span2 = false,
  ): FieldEntry | null => (vis(key) ? { key, label: t(labelKey, fallback), node, span2 } : null);

  const inlineText = (
    fieldName: string,
    value: string | null | undefined,
    opts: {
      dir?: "ltr";
      multiline?: boolean;
      validate?: (v: string) => string | null;
      disabled?: boolean;
    } = {},
  ) => (
    <InlineEdit<string>
      value={value ?? ""}
      display={<span dir={opts.dir}>{value || "—"}</span>}
      validate={opts.validate}
      disabled={opts.disabled ?? (!editable || shliachEditDisabled)}
      enterCommits={!opts.multiline}
      onSave={(v) => patch({ [fieldName]: v.trim() === "" ? null : v.trim() })}
      editor={(draft, setDraft) =>
        opts.multiline ? (
          <textarea
            className={inputClass}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          <input
            className={inputClass}
            dir={opts.dir}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        )
      }
    />
  );

  const inlinePicklist = (
    picklistKey: string,
    fieldName: string,
    value: string | null | undefined,
    labelFor: (v: string | null | undefined) => string | null | undefined,
  ) => (
    <InlineEdit<string | null>
      value={value ?? null}
      display={labelFor(value) || "—"}
      commitOnBlur={false}
      disabled={!editable || shliachEditDisabled}
      onSave={(v) => patch({ [fieldName]: v })}
      editor={(draft, _setDraft, commit) => (
        <PicklistSelect fieldKey={picklistKey} value={draft} onChange={commit} />
      )}
    />
  );

  // fixes51 §2.2: apartment.language is multi-select — same explicit-apply
  // pattern used across the app for a multi-select-inside-InlineEdit.
  const inlineLanguage = () => (
    <InlineEdit<string[]>
      value={apt.language}
      display={apt.language.map((v) => languageLabel(v)).join(", ") || "—"}
      commitOnBlur={false}
      disabled={!editable || shliachEditDisabled}
      onSave={(vals) => patch({ language: vals })}
      editor={(draft, setDraft, commit) => (
        <MultiSelectEditor onApply={() => commit(draft)}>
          <MultiSelectFilter
            allLabel={t("filter.all_languages", "כל השפות")}
            options={languagePicklist.options.map((o) => ({
              id: o.value,
              label: languagePicklist.display(o),
            }))}
            value={draft}
            onChange={setDraft}
          />
        </MultiSelectEditor>
      )}
    />
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/apartments" className="text-sm text-status-magenta hover:underline">
          {t("page.back_to_apartments", "← חזרה לדירות")}
        </Link>
        <div className="flex items-center gap-2">
          {/* fixes30 §2: the edit button is gone — every field below edits in
              place. fixes22 §2 still holds: the backend scopes shliach edits
              to their assigned apartments (others get the save-failed toast). */}
          {isAdmin && (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md border border-status-darkred/40 text-status-darkred px-3 py-1.5 text-sm hover:bg-red-50"
            >
              {t("action.delete", "מחק")}
            </button>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmModal
          message={t("apt.delete_confirm", "למחוק את הדירה?")}
          detail={apartmentTitle(apt)}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={remove}
        />
      )}

      <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
          <h1 className="text-2xl font-bold">{apartmentTitle(apt)}</h1>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">{t("apartments.building_id", "בניין")}</dt>
              <dd className="font-medium flex items-baseline gap-2">
                {building ? (
                  <Link
                    href={`/dashboard/buildings/${building.id}`}
                    className="text-status-magenta hover:underline"
                  >
                    {buildingDisplayName(building)}
                  </Link>
                ) : (
                  "—"
                )}
                {/* The name stays a nav link, so a separate small trigger
                    opens the move-building select (fixes30 §2). */}
                {editable && (
                <InlineEdit<number | null>
                  value={apt.building_id}
                  display={
                    <span className="text-xs text-gray-400">
                      {t("action.edit", "ערוך")}
                    </span>
                  }
                  commitOnBlur={false}
                  onOpen={loadBuildingsIfNeeded}
                  onSave={(v) => (v == null ? Promise.resolve() : patch({ building_id: v }))}
                  editor={(draft, _setDraft, commit) => (
                    <SearchableSelect
                      value={draft}
                      onChange={(id) => commit(id ?? null)}
                      options={buildings.map((b) => ({
                        id: b.id,
                        label: buildingDisplayName(b),
                      }))}
                      placeholder={t("apt.choose_building", "בחר בניין…")}
                    />
                  )}
                />
                )}
              </dd>
            </div>
            {(() => {
              // fixes40 round 2 §4B: every toggleable field/custom field/
              // custom picklist collects into one array, sorted by its
              // dashboard/fields order, then rendered — building (above)
              // and building_address (below) are fixed structural anchors,
              // never toggleable, so they render outside this sorted block.
              const entries: FieldEntry[] = [
                field(
                  "apartments.floor",
                  "apartments.floor",
                  "קומה",
                  <InlineEdit<string | null>
                    value={apt.floor ?? null}
                    display={apt.floor || "—"}
                    commitOnBlur={false}
                    disabled={!editable || shliachEditDisabled}
                    onSave={(v) => patch({ floor: v })}
                    editor={(draft, _setDraft, commit) => (
                      <select
                        className={inputClass}
                        value={draft ?? ""}
                        onChange={(e) =>
                          commit(e.target.value === "" ? null : e.target.value)
                        }
                      >
                        <option value="">—</option>
                        {floors.map((f) => (
                          <option key={f.id} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    )}
                  />,
                ),
                field(
                  "apartments.apartment_name",
                  "apartments.apartment_name",
                  "מספר דירה",
                  // fixes51 §2.1: a shliach may never edit the apartment
                  // number, even for apartments assigned to them.
                  inlineText("apartment_name", apt.apartment_name, {
                    disabled: !editable || isShliach,
                  }),
                ),
                field(
                  "apartments.name",
                  "apartments.name",
                  "שם דייר",
                  inlineText("name", apt.name),
                ),
                field(
                  "apartments.phone",
                  "apartments.phone",
                  "טלפון",
                  inlineText("phone", apt.phone, {
                    dir: "ltr",
                    validate: (v) =>
                      v.trim() === "" || isValidPhone(v.trim())
                        ? null
                        : t("validation.phone_hint", PHONE_HINT),
                  }),
                ),
                field(
                  "apartments.email",
                  "apartments.email",
                  "אימייל",
                  inlineText("email", apt.email, {
                    dir: "ltr",
                    validate: (v) =>
                      v.trim() === "" || isValidEmail(v.trim())
                        ? null
                        : t("validation.email_hint", EMAIL_HINT),
                  }),
                ),
                field(
                  "apartment.Jewish_status",
                  "picklist.apartment.Jewish_status",
                  "יהדות",
                  inlinePicklist(
                    "apartment.Jewish_status",
                    "jewish_status",
                    apt.jewish_status,
                    jewishLabel,
                  ),
                ),
                field(
                  "apartment.campaign_status",
                  "picklist.apartment.campaign_status",
                  "סטטוס קמפיין",
                  inlinePicklist(
                    "apartment.campaign_status",
                    "campaign_status",
                    apt.campaign_status,
                    campaignLabel,
                  ),
                ),
                field(
                  "apartment.mezuzah_status",
                  "picklist.apartment.mezuzah_status",
                  "מזוזה",
                  inlinePicklist(
                    "apartment.mezuzah_status",
                    "mezuzah_status",
                    apt.mezuzah_status,
                    mezuzahLabel,
                  ),
                ),
                field(
                  "apartment.language",
                  "picklist.apartment.language",
                  "שפה",
                  inlineLanguage(),
                ),
                field(
                  "apartments.report_number_id",
                  "apartments.report_number_id",
                  "מספר דוח",
                  <InlineEdit<number | null>
                    value={apt.report_number_id ?? null}
                    display={
                      reportNumbers.find((rn) => rn.id === apt.report_number_id)?.name || "—"
                    }
                    commitOnBlur={false}
                    disabled={!editable || shliachEditDisabled}
                    onSave={(v) => patch({ report_number_id: v })}
                    editor={(draft, _setDraft, commit) => (
                      <SearchableSelect
                        value={draft}
                        onChange={(id) => commit(id ?? null)}
                        options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
                        placeholder={t("apt.choose_report_number", "בחר מספר דוח…")}
                      />
                    )}
                  />,
                ),
                field(
                  "apartments.apartment_notes",
                  "apartments.apartment_notes",
                  "הערות",
                  inlineText("apartment_notes", apt.apartment_notes, { multiline: true }),
                  true,
                ),
                ...customDefs
                  .filter((d) => vis(d.field_key))
                  .map(
                    (d): FieldEntry => ({
                      key: d.field_key,
                      label: (lang === "en" ? d.english_label || d.label : d.label) || d.field_key,
                      node: (
                        <InlineEdit<string | null>
                          value={apt.picklist_values?.[d.field_key] ?? null}
                          display={
                            customLabel(d.field_key, apt.picklist_values?.[d.field_key]) || "—"
                          }
                          commitOnBlur={false}
                          disabled={!editable || shliachEditDisabled}
                          onSave={(v) => patch({ picklist_values: { [d.field_key]: v } })}
                          editor={(draft, _setDraft, commit) => (
                            <PicklistSelect fieldKey={d.field_key} value={draft} onChange={commit} />
                          )}
                        />
                      ),
                    }),
                  ),
                // fixes35: any non-select apartment custom field.
                ...customFieldDefs
                  .filter((d) => vis(`customfield.apartment.${d.field_key}`))
                  .map(
                    (d): FieldEntry => ({
                      key: `customfield.apartment.${d.field_key}`,
                      label:
                        (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                        d.field_key,
                      node: (
                        <InlineEdit<string | number | boolean | null>
                          value={apt.custom_field_values?.[d.field_key] ?? null}
                          display={
                            <CustomFieldValueDisplay
                              fieldType={d.field_type}
                              value={apt.custom_field_values?.[d.field_key] ?? null}
                            />
                          }
                          commitOnBlur={d.field_type === "text" || d.field_type === "number"}
                          disabled={!editable || shliachEditDisabled}
                          onSave={(v) => patch({ custom_field_values: { [d.field_key]: v } })}
                          editor={(draft, setDraft, commit) => (
                            <CustomFieldValueInput
                              fieldType={d.field_type}
                              value={draft}
                              onChange={
                                d.field_type === "boolean" || d.field_type === "date"
                                  ? commit
                                  : setDraft
                              }
                            />
                          )}
                        />
                      ),
                    }),
                  ),
              ].filter((e): e is FieldEntry => e !== null);

              return sortByFieldOrder(entries, (e) => e.key, orderFor).map((e) => (
                <div key={e.key} className={e.span2 ? "sm:col-span-2" : undefined}>
                  <dt className="text-gray-500">{e.label}</dt>
                  <dd className="font-medium">{e.node}</dd>
                </div>
              ));
            })()}
            {building?.building_address && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500">{t("buildings.building_address", "כתובת בניין")}</dt>
                <dd className="font-medium">
                  {/* fixes30 §4: the shluchim display navigates via Maps. */}
                  {isShliach ? (
                    <a
                      href={mapsHref(building.building_address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t("apt.navigate", "ניווט בגוגל מפות")}
                      className="text-status-magenta hover:underline"
                    >
                      📍 {building.building_address}
                    </a>
                  ) : (
                    building.building_address
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>

      {/* fixes19 §3: admin edit history — pick a previous version to view a
          read-only snapshot (Wikipedia-revisions style). */}
      {isAdmin && (
        <section className="bg-white rounded-xl shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500">
            {t("apt.history", "היסטוריית שינויים")}
          </h2>
          {history.length === 0 ? (
            <p className="text-sm text-gray-400">
              {t("apt.history_none", "אין גרסאות קודמות.")}
            </p>
          ) : (
            <>
              <select
                className="w-full sm:w-auto rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
                value={snapshot?.id ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setSnapshot(history.find((h) => h.id === id) ?? null);
                }}
              >
                <option value="">{t("apt.history_pick", "בחר גרסה קודמת…")}</option>
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {(h.editor_name || t("apt.history_unknown_editor", "עורך לא ידוע")) +
                      " — " +
                      (h.last_edit ? new Date(h.last_edit).toLocaleString("he-IL") : "")}
                  </option>
                ))}
              </select>
              {snapshot && (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-gray-500">
                      {t("apt.history_snapshot", "תצוגת גרסה היסטורית (לקריאה בלבד)")}
                    </p>
                    <button
                      onClick={() => setSnapshot(null)}
                      className="text-xs text-status-magenta hover:underline"
                    >
                      {t("apt.history_back_current", "חזרה לגרסה הנוכחית")}
                    </button>
                  </div>
                  {/* fixes22 §2: each field can be restored to this version's
                      value (a new active version is created on restore). */}
                  <p className="text-xs text-gray-400">
                    {t("apt.restore_hint", "לחץ \"שחזר\" ליד שדה כדי להחזיר את ערכו לגרסה זו.")}
                  </p>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <SnapRow label={t("apartments.apartment_name", "מספר דירה")} value={snapshot.apartment_name} field="apartment_name" onRestore={restoreField} t={t} />
                    <SnapRow label={t("apartments.floor", "קומה")} value={snapshot.floor} field="floor" onRestore={restoreField} t={t} />
                    <SnapRow label={t("apartments.name", "שם דייר")} value={snapshot.name} field="name" onRestore={restoreField} t={t} />
                    <SnapRow label={t("apartments.phone", "טלפון")} value={snapshot.phone} dir="ltr" field="phone" onRestore={restoreField} t={t} />
                    <SnapRow label={t("apartments.email", "אימייל")} value={snapshot.email} dir="ltr" field="email" onRestore={restoreField} t={t} />
                    <SnapRow label={t("picklist.apartment.Jewish_status", "יהדות")} value={jewishLabel(snapshot.jewish_status)} field="jewish_status" onRestore={restoreField} t={t} />
                    <SnapRow label={t("picklist.apartment.campaign_status", "סטטוס קמפיין")} value={campaignLabel(snapshot.campaign_status)} field="campaign_status" onRestore={restoreField} t={t} />
                    <SnapRow label={t("picklist.apartment.mezuzah_status", "מזוזה")} value={mezuzahLabel(snapshot.mezuzah_status)} field="mezuzah_status" onRestore={restoreField} t={t} />
                    <SnapRow label={t("picklist.apartment.language", "שפה")} value={snapshot.language.map((v) => languageLabel(v)).join(", ")} field="language" onRestore={restoreField} t={t} />
                    <SnapRow
                      label={t("apartments.report_number_id", "מספר דוח")}
                      value={
                        reportNumbers.find((rn) => rn.id === snapshot.report_number_id)
                          ?.name ?? null
                      }
                      field="report_number_id"
                      onRestore={restoreField}
                      t={t}
                    />
                    <div className="sm:col-span-2">
                      <SnapRow label={t("apartments.apartment_notes", "הערות")} value={snapshot.apartment_notes} field="apartment_notes" onRestore={restoreField} t={t} />
                    </div>
                  </dl>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Linked contact (mekurav) — name links to their contact page. */}
      <section className="bg-white rounded-xl shadow-sm p-5 space-y-2">
        <h2 className="text-sm font-semibold text-gray-500">{t("apt.contact", "איש קשר")}</h2>
        {linked ? (
          <Link
            href={`/dashboard/contacts/${linked.id}`}
            className="inline-block rounded-full bg-status-magenta/10 text-status-magenta px-3 py-1 text-sm hover:bg-status-magenta/20"
          >
            {linked.name}
          </Link>
        ) : (
          <p className="text-sm text-gray-400">{t("apt.no_contact", "ללא איש קשר")}</p>
        )}
      </section>
    </div>
  );
}

/** One label/value row of a read-only historical snapshot (fixes19 §3), with an
 *  optional per-field Restore action (fixes22 §2). */
function SnapRow({
  label,
  value,
  dir,
  field,
  onRestore,
  t,
}: {
  label: string;
  value: string | null | undefined;
  dir?: "ltr";
  field?: string;
  onRestore?: (field: string) => Promise<void>;
  t?: (key: string, fallback?: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  async function restore() {
    if (!field || !onRestore) return;
    setBusy(true);
    try {
      await onRestore(field);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <dt className="text-gray-500 flex items-center justify-between gap-2">
        <span>{label}</span>
        {field && onRestore && (
          <button
            type="button"
            onClick={restore}
            disabled={busy}
            className="text-[11px] text-status-magenta hover:underline disabled:opacity-50"
          >
            {busy ? "…" : t?.("apt.restore", "שחזר") ?? "Restore"}
          </button>
        )}
      </dt>
      <dd className="font-medium" dir={dir}>
        {value || "—"}
      </dd>
    </div>
  );
}
