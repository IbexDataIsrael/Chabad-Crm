"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmModal } from "@/components/ConfirmModal";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import { useToast } from "@/lib/toast";
import {
  apartmentTitle,
  buildingDisplayName,
  type Apartment,
  type ApartmentPage,
  type ApartmentVersion,
  type Building,
  type ReportNumber,
} from "@/lib/types";

/** Apartment card: view + edit, the same structural flow as a CRM contact
 *  (fixes7 §2 — fetch detail, edit button → form → PUT → refreshed view). */
export default function ApartmentDetailPage() {
  const router = useRouter();
  const { loading, isAdmin } = useAuth();
  const { t } = useLocalization();
  const { isFieldVisible: vis } = useFieldSettings();
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

  const { labelFor: jewishLabel } = usePicklist("apartment.Jewish_status");
  const { labelFor: campaignLabel } = usePicklist("apartment.campaign_status");
  const { labelFor: mezuzahLabel } = usePicklist("apartment.mezuzah_status");
  const { labelFor: languageLabel } = usePicklist("apartment.language");

  async function reload() {
    const a = await apiFetch<Apartment>(`/api/apartments/${apartmentId}`);
    setApt(a);
    setBuilding(await apiFetch<Building>(`/api/buildings/${a.building_id}`).catch(() => null));
    // The linked contact comes from the enriched list (shliach-scoped too);
    // apartment_id fetches just this row instead of the whole building (fixes8).
    const enriched = await apiFetch<ApartmentPage>(
      `/api/apartments/list?apartment_id=${apartmentId}`,
    ).catch(() => null);
    const row = enriched?.items[0];
    setLinked(
      row?.contact_id ? { id: row.contact_id, name: row.contact_name ?? "" } : null,
    );
    setReportNumbers(
      await apiFetch<ReportNumber[]>("/api/report-numbers").catch(() => []),
    );
    if (isAdmin) {
      setHistory(
        await apiFetch<ApartmentVersion[]>(
          `/api/apartments/${apartmentId}/history`,
        ).catch(() => []),
      );
    }
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

  const field = (
    key: string,
    labelKey: string,
    fallback: string,
    value: string | null | undefined,
    dir?: "ltr",
  ) =>
    vis(key) ? (
      <div>
        <dt className="text-gray-500">{t(labelKey, fallback)}</dt>
        <dd className="font-medium" dir={dir}>
          {value || "—"}
        </dd>
      </div>
    ) : null;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/apartments" className="text-sm text-status-magenta hover:underline">
          {t("page.back_to_apartments", "← חזרה לדירות")}
        </Link>
        <div className="flex items-center gap-2">
          {/* fixes12 §2.4: this page is a clean read-only reference view —
              editing lives on the dedicated /apartments/edit/{id} route.
              fixes22 §2: shluchim may now edit apartments assigned to them
              (the backend scopes their edits + versions them like anyone's). */}
          {(
            <Link
              href={`/dashboard/apartments/edit/${apartmentId}?return=${encodeURIComponent(
                `/dashboard/apartments/${apartmentId}`,
              )}`}
              className="rounded-md bg-gray-800 text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
            >
              {t("action.edit", "ערוך")}
            </Link>
          )}
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
              <dd className="font-medium">
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
              </dd>
            </div>
            {field("apartments.floor", "apartments.floor", "קומה", apt.floor)}
            {field(
              "apartments.apartment_name",
              "apartments.apartment_name",
              "מספר דירה",
              apt.apartment_name,
            )}
            {field("apartments.name", "apartments.name", "שם דייר", apt.name)}
            {field("apartments.phone", "apartments.phone", "טלפון", apt.phone, "ltr")}
            {field("apartments.email", "apartments.email", "אימייל", apt.email, "ltr")}
            {field(
              "apartment.Jewish_status",
              "picklist.apartment.Jewish_status",
              "יהדות",
              jewishLabel(apt.jewish_status),
            )}
            {field(
              "apartment.campaign_status",
              "picklist.apartment.campaign_status",
              "סטטוס קמפיין",
              campaignLabel(apt.campaign_status),
            )}
            {field(
              "apartment.mezuzah_status",
              "picklist.apartment.mezuzah_status",
              "מזוזה",
              mezuzahLabel(apt.mezuzah_status),
            )}
            {field(
              "apartment.language",
              "picklist.apartment.language",
              "שפה",
              languageLabel(apt.language),
            )}
            {field(
              "apartments.report_number_id",
              "apartments.report_number_id",
              "מספר דוח",
              reportNumbers.find((rn) => rn.id === apt.report_number_id)?.name ?? null,
            )}
            {building?.building_address && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500">{t("buildings.building_address", "כתובת בניין")}</dt>
                <dd className="font-medium">{building.building_address}</dd>
              </div>
            )}
            {vis("apartments.apartment_notes") && (
              <div className="sm:col-span-2">
                <dt className="text-gray-500">{t("apartments.apartment_notes", "הערות")}</dt>
                <dd className="font-medium">{apt.apartment_notes || "—"}</dd>
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
                    <SnapRow label={t("picklist.apartment.language", "שפה")} value={languageLabel(snapshot.language)} field="language" onRestore={restoreField} t={t} />
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
