"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ApartmentEditor } from "@/components/ApartmentEditor";
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
  type ApartmentListItem,
  type Building,
} from "@/lib/types";

/** Apartment card: view + edit, the same structural flow as a CRM contact
 *  (fixes7 §2 — fetch detail, edit button → form → PUT → refreshed view). */
export default function ApartmentDetailPage() {
  const router = useRouter();
  const { loading, isAdmin, isShliach } = useAuth();
  const { t } = useLocalization();
  const { isFieldVisible: vis } = useFieldSettings();
  const { success } = useToast();
  const params = useParams<{ id: string }>();
  const apartmentId = Number(params.id);

  const [apt, setApt] = useState<Apartment | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [linked, setLinked] = useState<{ id: number; name: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const { labelFor: jewishLabel } = usePicklist("apartment.Jewish_status");
  const { labelFor: campaignLabel } = usePicklist("apartment.campaign_status");
  const { labelFor: mezuzahLabel } = usePicklist("apartment.mezuzah_status");

  async function reload() {
    const a = await apiFetch<Apartment>(`/api/apartments/${apartmentId}`);
    setApt(a);
    setBuilding(await apiFetch<Building>(`/api/buildings/${a.building_id}`).catch(() => null));
    // The linked contact comes from the enriched list (shliach-scoped too).
    const items = await apiFetch<ApartmentListItem[]>(
      `/api/apartments/list?building_id=${a.building_id}`,
    ).catch(() => [] as ApartmentListItem[]);
    const row = items.find((x) => x.id === apartmentId);
    setLinked(
      row?.contact_id ? { id: row.contact_id, name: row.contact_name ?? "" } : null,
    );
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

  async function remove() {
    if (!apt) return;
    if (!confirm(`${t("apt.delete_confirm", "למחוק את הדירה?")} '${apartmentTitle(apt)}'`)) return;
    await apiFetch(`/api/apartments/${apt.id}`, { method: "DELETE" });
    success(t("msg.deleted", "נמחק בהצלחה"));
    router.push("/dashboard/apartments");
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
        {!editing && (
          <div className="flex items-center gap-2">
            {!isShliach && (
              <button
                onClick={() => setEditing(true)}
                className="rounded-md bg-gray-800 text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
              >
                {t("action.edit", "ערוך")}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={remove}
                className="rounded-md border border-status-darkred/40 text-status-darkred px-3 py-1.5 text-sm hover:bg-red-50"
              >
                {t("action.delete", "מחק")}
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <ApartmentEditor
            apt={apt}
            onClose={() => setEditing(false)}
            onSaved={async () => {
              setEditing(false);
              await reload();
              success(t("msg.saved", "נשמר בהצלחה"));
            }}
          />
        </div>
      ) : (
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
              "תווית",
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
