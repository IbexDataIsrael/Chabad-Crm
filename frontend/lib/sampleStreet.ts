import type { ApartmentListItem } from "@/lib/types";

/**
 * fixes79: practice data for an activist who has no taken (ACTIVE) task yet —
 * shown in street2 instead of an empty screen, under a clear "בניין לדוגמא"
 * notice. A fixed snapshot of the layout of prod building 9 (org 1, "1414
 * President St": 4 floors × 4 apartments), NOT a live read of that building:
 * every organization gets it, so it must never carry another tenant's rows.
 * No resident data; every door starts "to knock" so there is something to
 * practise on. Negative ids can never collide with a real apartment, and
 * street2 keeps every edit local in sample mode (nothing is sent).
 */
export const SAMPLE_BUILDING_ID = -9;

export function buildSampleApartments(areaLabel: string): ApartmentListItem[] {
  const items: ApartmentListItem[] = [];
  for (let floor = 1; floor <= 4; floor++) {
    for (let apt = 1; apt <= 4; apt++) {
      const id = -(floor * 100 + apt);
      items.push({
        id,
        guid: `sample-${floor}-${apt}`,
        building_id: SAMPLE_BUILDING_ID,
        apartment_name: String(apt),
        apartment_notes: null,
        floor: String(floor),
        jewish_status: null,
        campaign_status: null,
        mezuzah_status: null,
        language: [],
        name: null,
        phone: null,
        email: null,
        report_number_id: null,
        is_display: true,
        last_edit: null,
        root_id: null,
        picklist_values: {},
        custom_field_values: {},
        building_name: null,
        building_address: "1414 President St, Brooklyn, NY 11213",
        area_name: areaLabel,
        contact_id: null,
        contact_name: null,
        report_number_name: null,
      });
    }
  }
  return items;
}

// Mirrors backend apartments._NO_KNOCK_VALUES (_sync_to_knock).
const NO_KNOCK_VALUES = new Set(["not_jewish", "gentile", "na", "dont_knock"]);

/** What a PUT would have returned, computed locally for a sample door: the
 *  patch merged in, the door marked worked (root_id set, like a real saved
 *  version) and to_knock re-derived from the Jewish status like the server. */
export function applySamplePatch(
  apt: ApartmentListItem,
  patch: Record<string, unknown>,
): ApartmentListItem {
  const { picklist_values, custom_field_values, ...fields } = patch as {
    picklist_values?: Record<string, string | null>;
    custom_field_values?: Record<string, unknown>;
  } & Record<string, unknown>;
  const next: ApartmentListItem = {
    ...apt,
    ...(fields as Partial<ApartmentListItem>),
    picklist_values: { ...apt.picklist_values, ...picklist_values },
    custom_field_values: {
      ...apt.custom_field_values,
      ...(custom_field_values as ApartmentListItem["custom_field_values"]),
    },
    root_id: apt.root_id ?? apt.id,
  };
  if ("jewish_status" in fields) {
    const v = fields.jewish_status as string | null;
    next.custom_field_values = {
      ...next.custom_field_values,
      to_knock: v == null || !NO_KNOCK_VALUES.has(v),
    };
  }
  return next;
}
