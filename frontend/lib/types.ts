export interface Checklist {
  contact_id: number;
  tefillin: boolean;
  tefillin_notes: string | null;
  tzedakah: boolean;
  charity_note: string | null;
  shabbat_candles: boolean;
  shabbat_candles_notes: string | null;
  torah_pamphlet: boolean;
  torah_pamphlet_notes: string | null;
  torah_thought: string | null;
  torah_letter: boolean;
  letter_torah_notes: string | null;
}

export interface CustomFieldDefinition {
  id: number;
  guid: string;
  field_key: string;
  hebrew_label: string;
  sort_order: number;
  is_active: boolean;
}

export interface ContactCustomField {
  definition_id: number;
  field_key: string;
  hebrew_label: string;
  checked: boolean;
  note: string | null;
}

export type ContactType = "mekurav" | "shliach";

export interface Mekurav {
  id: number;
  contact_id: number;
  apartment_id: number | null;
  admin_area_id: number | null; // אזור מנהל (fixes9)
  tzedaka_potential: string | null; // פוטנציאל לצדקה (fixes9)
  first_visit: string | null;
  potential_next_step: string | null;
  rebbe_connection: string | null;
  recommendations: string | null;
  background: string | null;
}

/** An administrative area (אזור מנהל, fixes9) mekurav contacts link to. */
export interface AdminArea {
  id: number;
  guid: string;
  name: string;
  comments: string | null;
  created_at?: string | null; // feeds date sorting (fixes15 §6)
}

export interface Shliach {
  id: number;
  contact_id: number;
  user_id: number | null;
  notes: string | null;
  apartment_ids: number[];
  area_ids: number[];
}

export interface Reminder {
  id?: number;
  offset_minutes: number;
  remind_at_time: string | null; // "HH:MM"
  channel: string;
  last_sent_at?: string | null;
}

export interface SignificantDate {
  id: number;
  guid: string;
  special_date: string;
  hebrew_date: string | null;
  special_date_type: string | null;
  special_date_title: string | null;
  is_set_reminder: boolean;
  reminders: Reminder[];
}

export interface Contact {
  id: number;
  guid: string;
  name: string;
  last_name: string | null;
  phone: string | null; // optional since the data import
  email: string | null;
  contact_type: ContactType;
  assigned_user_id: string | null; // owning user's GUID (fixes10)
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  pipeline_status: string | null;
  color_tag: string | null;
  priority_score: number | null;
  created_at: string;
  updated_at: string;
  checklist?: Checklist | null;
  mekurav?: Mekurav | null;
  shliach?: Shliach | null;
  special_dates?: SignificantDate[];
  /** Dynamic picklist selections, keyed by system_name. */
  picklist_values?: Record<string, string>;
  /** Enriched by /api/contacts/list only (fixes15 §5.1 grid columns). */
  building_name?: string | null;
  area_name?: string | null;
}

/** One server-side page of the contacts list (fixes8 §2C pattern). */
export interface ContactPage {
  items: Contact[];
  total: number;
  page: number;
  page_size: number;
}

/** The dynamic (admin-managed) picklists shown on the mekurav form, by system_name. */
export const MEKURAV_PICKLISTS = ["Jewish_status", "affiliation", "language"] as const;

export interface Area {
  id: number;
  guid: string;
  area_name: string;
  area_notes: string | null;
  area_polygon: string | null;
}

export interface Floor {
  id: number;
  guid: string;
  building_id: number;
  name: string;
  sort_order: number;
}

export interface Building {
  id: number;
  guid: string;
  area_id: number;
  building_name: string | null;
  building_address: string | null;
  longitude: number | null;
  latitude: number | null;
  floors?: Floor[];
}

export interface Apartment {
  id: number;
  guid: string;
  building_id: number;
  apartment_name: string | null;
  apartment_notes: string | null;
  floor: string | null;
  jewish_status: string | null;
  campaign_status: string | null;
  mezuzah_status: string | null;
  language: string | null; // picklist apartment.language (fixes13)
  name: string | null; // resident name
  phone: string | null;
  email: string | null;
}

/** Apartment enriched with building/area context + linked contact (apartments page). */
export interface ApartmentListItem extends Apartment {
  building_name: string | null;
  building_address: string | null;
  area_name: string | null;
  contact_id: number | null;
  contact_name: string | null;
}

/** One server-side page of the buildings list (fixes12 §3.3). */
export interface BuildingPage {
  items: Building[];
  total: number;
  page: number;
  page_size: number;
}

/** One server-side page of the enriched apartment list (fixes8 §2C). */
export interface ApartmentPage {
  items: ApartmentListItem[];
  total: number;
  page: number;
  page_size: number;
}

/** The "[number] [street]" segment of a formatted address (first comma part). */
export function streetPart(address: string | null | undefined): string | null {
  if (!address) return null;
  const first = address.split(",")[0].trim();
  return first || null;
}

/**
 * Canonical building display string (fixes7 §2): the composite address
 * "[street number] + [street name]" (e.g. "770 Eastern Pkwy"), falling back to
 * the legacy building name, then the id. Mirrors backend core/display.py.
 */
export function buildingDisplayName(b: {
  id: number;
  building_name?: string | null;
  building_address?: string | null;
}): string {
  return (
    streetPart(b.building_address) || (b.building_name ?? "").trim() || `#${b.id}`
  );
}

/**
 * Computed apartment title: label - floor — label "A" on floor "1" renders
 * "A - 1" (fixes17 §3.1: a space-isolated hyphen separates the parts) — with
 * fallbacks to whichever part exists, then the resident name, then the id.
 * Mirrors backend core/display.py.
 */
export function apartmentTitle(a: {
  id: number;
  apartment_name?: string | null;
  floor?: string | null;
  name?: string | null;
}): string {
  const label = (a.apartment_name ?? "").trim();
  const floor = (a.floor ?? "").trim();
  if (label && floor) return `${label} - ${floor}`;
  if (label || floor) return label || floor;
  return (a.name ?? "").trim() || `#${a.id}`;
}

export interface Interaction {
  id: number;
  contact_id: number;
  created_by: number;
  category: string;
  note: string;
  created_at: string;
}

export interface Visit {
  id: number;
  guid: string;
  contact_id: number | null;
  contact_name: string | null;
  visit_date: string;
  visit_type: string | null;
  location: string | null;
  notes: string | null;
}

export interface Donation {
  id: number;
  guid: string;
  contact_id: number | null;
  contact_name: string | null;
  donation_date: string;
  amount: number | null;
  is_ongoing: boolean;
  number_of_payments: number | null;
  notes: string | null;
}

export interface PicklistValue {
  id: number;
  field_key: string;
  value: string;
  hebrew_label: string;
  english_value: string | null;
  color_hint: string | null;
  sort_order: number;
  is_active: boolean;
  is_default: boolean;
}

export interface PicklistField {
  id: number;
  field_key: string;
  label: string; // hebrew display name
  english_label: string | null;
  is_system: boolean;
}

export interface OrgDetails {
  id: number;
  name: string;
  logo_url: string | null;
  map_in_english: boolean;
  default_lat: number | null;
  default_lng: number | null;
  default_zoom: number;
}

/** One org restore point (fixes16) — metadata only, the blob stays server-side. */
export interface OrgBackup {
  id: number;
  guid: string;
  note: string | null;
  kind: "manual" | "auto";
  created_by_name: string | null;
  created_at: string;
  counts: Record<string, number>;
}

export interface UserSummary {
  id: number;
  guid: string; // contact assignment key (fixes10)
  username: string;
  full_name: string;
  role: string;
  created_at: string;
}

export function emptyChecklist(contactId = 0): Checklist {
  return {
    contact_id: contactId,
    tefillin: false,
    tefillin_notes: null,
    tzedakah: false,
    charity_note: null,
    shabbat_candles: false,
    shabbat_candles_notes: null,
    torah_pamphlet: false,
    torah_pamphlet_notes: null,
    torah_thought: null,
    torah_letter: false,
    letter_torah_notes: null,
  };
}

/** Boolean + matching note column pairs, in display order. */
export const CHECKLIST_ROWS: { bool: keyof Checklist; note: keyof Checklist }[] = [
  { bool: "tefillin", note: "tefillin_notes" },
  { bool: "tzedakah", note: "charity_note" },
  { bool: "shabbat_candles", note: "shabbat_candles_notes" },
  { bool: "torah_pamphlet", note: "torah_pamphlet_notes" },
  { bool: "torah_letter", note: "letter_torah_notes" },
];

/** Composed display name: "<last> <first>" (falls back to whichever exists). */
export function contactFullName(c: { name: string; last_name?: string | null }): string {
  return [c.last_name, c.name].filter(Boolean).join(" ");
}

/**
 * Single source of truth for how coordinates are displayed: minimized to
 * `longitude,latitude` (x,y order) with 5 decimals. Returns "" when either is
 * missing so callers can fall back to a placeholder.
 */
export function formatCoords(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): string {
  if (latitude == null || longitude == null) return "";
  return `${longitude.toFixed(5)},${latitude.toFixed(5)}`;
}

/** Round a raw coordinate to the 5-decimal precision we store/display (~1m). */
export function roundCoord(n: number | null | undefined): number | null {
  return n == null ? null : Number(n.toFixed(5));
}

/** Boolean mitzvot fields, in display order. */
export const CHECKLIST_BOOLEANS: (keyof Checklist)[] = [
  "tefillin",
  "tzedakah",
  "shabbat_candles",
  "torah_pamphlet",
  "torah_letter",
];
