"use client";

import { Ban, Phone } from "lucide-react";

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

/** fixes68 §2.1/§5: one door, full screen. Top to bottom: the don't-knock
 *  banner (only when flagged, never dismissible), building/floor/apartment,
 *  area/report-number line, resident + tel: link, notes, last-outcome chip. */
export function DoorCard({ item }: { item: ApartmentRouteItem }) {
  const { t } = useLocalization();
  const isDoNotKnock = item.jewish_status === "not_jewish";
  const isMixedHousehold =
    !isDoNotKnock && item.jewish_status != null && MIXED_HOUSEHOLD_STATUSES.has(item.jewish_status);

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

        {item.apartment_notes && (
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {item.apartment_notes}
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
