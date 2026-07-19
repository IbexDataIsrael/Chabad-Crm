// fixes25: the contact-level Checklist type is gone — Mivtzoim flags live on
// the visit (see Visit / MIVTZOIM_FLAGS).

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
  // fixes25: rebbe_connection moved to the visit (connection_to_rebbe).
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
  /** fixes26 §4: state of the linked login account —
   *  'active' | 'disabled' | 'missing'. */
  login_status?: "active" | "disabled" | "missing" | null;
  notes: string | null;
  /** fixes19: report numbers replace the apartment coverage links. */
  report_number_ids: number[];
  area_ids: number[];
}

/** A report number (מספר דוח, fixes19) — org-scoped, admin-managed. */
export interface ReportNumber {
  id: number;
  guid: string;
  name: string;
  created_at?: string | null;
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
  mekurav?: Mekurav | null;
  shliach?: Shliach | null;
  special_dates?: SignificantDate[];
  /** Dynamic picklist selections, keyed by system_name. */
  picklist_values?: Record<string, string>;
  /** Enriched by /api/contacts/list only (fixes15 §5.1 grid columns;
   *  fixes18 §3.4 adds the linked admin-area name). */
  building_name?: string | null;
  area_name?: string | null;
  admin_area_name?: string | null;
  /** fixes27 §3: /list enrichment for shliach rows — the login account's
   *  state, driving the row-level suspended notice. */
  login_status?: "active" | "disabled" | "missing" | null;
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
  /** fixes19 §4: a town house gets no floors — one auto "<name>-th" unit. */
  is_town_house?: boolean;
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
  /** fixes19: linked report number (מספר דוח). */
  report_number_id?: number | null;
  /** fixes19 §3 versioning: false = a historical (read-only) snapshot. */
  is_display?: boolean;
  last_edit?: string | null;
  root_id?: number | null;
}

/** One historical apartment version (admin history view, fixes19 §3). */
export interface ApartmentVersion extends Apartment {
  editor_name: string | null;
}

/** Apartment enriched with building/area context + linked contact (apartments page). */
export interface ApartmentListItem extends Apartment {
  building_name: string | null;
  building_address: string | null;
  area_name: string | null;
  contact_id: number | null;
  contact_name: string | null;
  /** fixes20 §3: the linked report number's name (the id is on Apartment). */
  report_number_name: string | null;
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

/** fixes23 §2: a distinct (report number → building) pair, driving the
 *  conditional building filter on the apartments page. */
export interface ReportNumberBuildingLink {
  report_number_id: number;
  building_id: number;
}

/** fixes30 §1: apartment count per building under the current list filters —
 *  feeds the group-by-building header rows. */
export interface BuildingAggregate {
  building_id: number;
  count: number;
}

/** fixes23 §3: outcome of a bulk apartment update. */
export interface ApartmentBulkUpdateResult {
  updated: number;
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
 * Computed apartment title (fixes21 §2): concatenate "[apartment number][floor]"
 * with no separator — number "A" + floor "2" → "A2". Both present → "A2"; only
 * one → that one; neither → resident name → id. Mirrors backend
 * core/display.py apartment_title.
 */
export function apartmentTitle(a: {
  id: number;
  apartment_name?: string | null;
  floor?: string | null;
  name?: string | null;
}): string {
  const label = (a.apartment_name ?? "").trim();
  const floor = (a.floor ?? "").trim();
  if (label && floor) return `${label}${floor}`;
  if (label || floor) return label || floor;
  return (a.name ?? "").trim() || `#${a.id}`;
}

/** One entry of a visit's interaction log (fixes25 — JSON on the visit). */
export interface VisitInteraction {
  category: string;
  note: string;
  created_at?: string | null;
  author_name?: string | null;
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
  // fixes25: visit-level engagement data.
  interactions: VisitInteraction[];
  tefillin: boolean;
  tzedakah: boolean;
  shabbat_candles: boolean;
  torah_pamphlet: boolean;
  letter_in_torah: boolean;
  torah_thought: string | null;
  connection_to_rebbe: string | null;
}

/** The visit's Mivtzoim boolean flags, with their visits.* label keys. */
export const MIVTZOIM_FLAGS = [
  "tefillin",
  "tzedakah",
  "shabbat_candles",
  "torah_pamphlet",
  "letter_in_torah",
] as const;
export type MivtzoimFlag = (typeof MIVTZOIM_FLAGS)[number];

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
  /** fixes18 §6: may shliach users view (mekurav) contacts? Default false. */
  shliach_can_view_contacts: boolean;
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

