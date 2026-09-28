"use client";

import { Ban, Mail, Phone } from "lucide-react";

import { CustomFieldValueDisplay } from "@/components/CustomFieldValueInput";
import type { CustomFieldDefinition } from "@/lib/types";
import { useLocalization } from "@/lib/localization";
import { apartmentTitle, buildingDisplayName, type ApartmentRouteItem, type DoorOutcome } from "@/lib/types";

// fixes68 §5.2: contains a Jew — never don't-knock, just a neutral info line.
const MIXED_HOUSEHOLD_STATUSES = new Set(["jewish_gentile", "jewish_interested_gentile"]);

export const OUTCOME_KEY: Record<DoorOutcome, string> = {
  answered: "activist_route.outcome.answered",
  not_home: "activist_route.outcome.not_home",
  jewish: "activist_route.outcome.jewish",
  not_jewish: "activist_route.outcome.not_jewish",
  come_back_later: "activist_route.outcome.come_back_later",
};

export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface DoorCardProps {
  item: ApartmentRouteItem;
  /** Hebrew/English label for a picklist field's stored value — covers the 3
   *  fixed apartment picklists shown below (Jewish/mezuzah/campaign status)
   *  plus any admin-added "apartment.*" one via `dynamicPicklistFields`. */
  picklistLabelFor: (fieldKey: string, value: string | null | undefined) => string;
  /** Admin-added apartment.* select fields beyond the 3 fixed ones. */
  dynamicPicklistFields: { field_key: string; label: string; english_label: string | null }[];
  /** Admin-added apartment custom fields (non-select: text/number/boolean/date). */
  customFieldDefs: CustomFieldDefinition[];
}

/** fixes68 §2.1/§5: one door, full screen — every apartment field, not a
 *  trimmed subset (a "not_jewish" mark still only shows once, as the loud
 *  don't-knock banner; every other value renders as an ordinary detail
 *  line). Top to bottom: don't-knock banner (only when flagged, never
 *  dismissible), building/floor/apartment, area/report-number line,
 *  resident + tel:/mailto: links, notes, status fields, any admin-added
 *  picklist/custom fields, last-outcome chip. */
export function DoorCard({ item, picklistLabelFor, dynamicPicklistFields, customFieldDefs }: DoorCardProps) {
  const { t, lang } = useLocalization();
  const isDoNotKnock = item.jewish_status === "not_jewish";
  const isMixedHousehold =
    !isDoNotKnock && item.jewish_status != null && MIXED_HOUSEHOLD_STATUSES.has(item.jewish_status);
  const otherJewishStatus = !isDoNotKnock && !isMixedHousehold ? item.jewish_status : null;

  const detailRows: { label: string; value: string }[] = [];
  if (otherJewishStatus) {
    detailRows.push({
      label: t("picklist_def.apartment.Jewish_status", "יהדות"),
      value: picklistLabelFor("apartment.Jewish_status", otherJewishStatus),
    });
  }
  if (item.mezuzah_status) {
    detailRows.push({
      label: t("picklist_def.apartment.mezuzah_status", "מזוזה"),
      value: picklistLabelFor("apartment.mezuzah_status", item.mezuzah_status),
    });
  }
  if (item.campaign_status) {
    detailRows.push({
      label: t("picklist_def.apartment.campaign_status", "סטטוס קמפיין"),
      value: picklistLabelFor("apartment.campaign_status", item.campaign_status),
    });
  }
  if (item.language && item.language.length > 0) {
    detailRows.push({
      label: t("picklist_def.apartment.language", "שפה"),
      value: item.language.map((v) => picklistLabelFor("apartment.language", v)).join(", "),
    });
  }
  for (const f of dynamicPicklistFields) {
    const raw = item.picklist_values?.[f.field_key];
    if (!raw) continue;
    detailRows.push({
      label: (lang === "en" ? f.english_label : f.label) || f.field_key,
      value: picklistLabelFor(f.field_key, raw),
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      {isDoNotKnock && (
        <div className="flex items-center gap-2 bg-status-darkred px-4 py-3 text-white">
          <Ban className="h-5 w-5 shrink-0" />
          <span className="font-bold">
            {t("activist_route.do_not_knock", "לא לדפוק - דייר לא יהודי")}
          </span>
        </div>
      )}

      <div className="flex-1 space-y-4 p-5">
        <div>
          <div className="text-2xl font-bold">{buildingDisplayName(item)}</div>
          <div className="text-lg text-muted-foreground">{apartmentTitle(item)}</div>
          {(item.area_name || item.report_number_name) && (
            <div className="mt-1 text-sm text-muted-foreground">
              {[item.area_name, item.report_number_name].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>

        {isMixedHousehold && (
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t("activist_route.mixed_household", "משפחה מעורבת (כולל יהודי)")}
          </div>
        )}

        {item.name && <div className="text-lg font-medium">{item.name}</div>}

        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {item.phone && (
            <a
              href={`tel:${item.phone}`}
              aria-label={t("activist_route.call", "התקשר")}
              className="inline-flex items-center gap-2 text-primary underline-offset-2 hover:underline"
            >
              <Phone className="h-5 w-5" />
              <span dir="ltr">{item.phone}</span>
            </a>
          )}
          {item.email && (
            <a
              href={`mailto:${item.email}`}
              className="inline-flex items-center gap-2 text-primary underline-offset-2 hover:underline"
            >
              <Mail className="h-5 w-5" />
              <span dir="ltr">{item.email}</span>
            </a>
          )}
        </div>

        {item.apartment_notes && (
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {item.apartment_notes}
          </div>
        )}

        {detailRows.length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
            {detailRows.map((row) => (
              <div key={row.label} className="contents">
                <div className="text-muted-foreground">{row.label}</div>
                <div>{row.value}</div>
              </div>
            ))}
          </div>
        )}

        {customFieldDefs.length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
            {customFieldDefs.map((d) => {
              const value = item.custom_field_values?.[d.field_key] ?? null;
              if (value == null || value === "") return null;
              return (
                <div key={d.field_key} className="contents">
                  <div className="text-muted-foreground">
                    {(lang === "en" ? d.english_label : d.hebrew_label) || d.field_key}
                  </div>
                  <div>
                    <CustomFieldValueDisplay fieldType={d.field_type} value={value} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {item.last_outcome && item.last_outcome_at && (
          <div className="inline-block rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">
            {t("activist_route.marked", "סומן: {outcome}, {time}")
              .replace("{outcome}", t(OUTCOME_KEY[item.last_outcome], item.last_outcome))
              .replace("{time}", formatClockTime(item.last_outcome_at))}
          </div>
        )}
      </div>
    </div>
  );
}
