// fixes25: the contact-level Checklist type is gone — Mivtzoim flags live on
// the visit. fixes39: they're ordinary entity_type="visit" boolean custom
// fields now (checked via the legacy /custom-fields sub-resource, same as
// any admin-added checklist item) — no dedicated Visit fields for them.

// fixes35: any of the 4 entities x 5 field types (originally visit-only
// boolean+note — CustomFieldDefinition generalized in place, see
// docs/fixes35-plan.md). field_type "select" never has its own value store:
// its options/selected values ride the existing picklist system instead.
export type CustomFieldEntityType =
  | "contact_mekurav"
  | "contact_shliach"
  | "visit"
  | "apartment"
  | "task";
export type CustomFieldType = "text" | "number" | "boolean" | "date" | "select";
/** One entity's non-select custom field values, keyed by field_key. */
export type CustomFieldValueMap = Record<string, string | number | boolean | null>;

export interface CustomFieldDefinition {
  id: number;
  guid: string;
  field_key: string;
  hebrew_label: string;
  english_label: string | null;
  entity_type: CustomFieldEntityType;
  field_type: CustomFieldType;
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
  /** fixes45: the active version's identity snapshot (mirrors the linked
   *  User/Contact). */
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
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
  picklist_values?: Record<string, string | null>;
  /** fixes35: non-select custom field values (contact_mekurav or
   *  contact_shliach, matching this contact's own contact_type). */
  custom_field_values?: CustomFieldValueMap;
  /** Enriched by /api/contacts/list only (fixes15 §5.1 grid columns;
   *  fixes18 §3.4 adds the linked admin-area name). */
  building_name?: string | null;
  area_name?: string | null;
  admin_area_name?: string | null;
  /** fixes48 §2: raw ids behind building_name/admin_area_name — needed to
   *  pre-populate the Contacts grid's inline admin-area/building editors. */
  apartment_id?: number | null;
  admin_area_id?: number | null;
  /** fixes27 §3: /list enrichment for shliach rows — the login account's
   *  state, driving the row-level suspended notice. */
  login_status?: "active" | "disabled" | "missing" | null;
  /** Where the contact came from ('crm' | 'instinct') and whether it is
   *  approved ('active') or an Instinct draft awaiting approval ('draft'). */
  source?: string;
  status?: "active" | "draft";
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

// fixes60 §5: one area's outcome from a convex-hull polygon generation run.
export interface GeneratePolygonResult {
  area_id: number;
  area_name: string;
  ok: boolean;
  building_count: number;
  skipped_reason: string | null;
}

export interface Floor {
  id: number;
  guid: string;
  building_id: number;
  name: string;
  sort_order: number;
}

/** fixes63: a row from the global `building_type` registry — id is the
 *  stored technical value ('building' | 'town_house' | 'divided_town_house'). */
export interface BuildingType {
  id: string;
  name_en: string;
  name_he: string;
}

export interface Building {
  id: number;
  guid: string;
  /** fixes33 §2.2: nullable — an area delete may unassign its buildings. */
  area_id: number | null;
  building_name: string | null;
  building_address: string | null;
  longitude: number | null;
  latitude: number | null;
  /** fixes19 §4: a town house gets no floors — one auto apartment unit. */
  is_town_house?: boolean;
  /** fixes63: 'building' | 'town_house' | 'divided_town_house'. */
  building_type_id?: string;
  floors?: Floor[];
  /** fixes63: server-derived from `building_type_id` — true only for a
   *  plain, undivided town house (false once it's been split into multiple
   *  apartment units). Drives the small-house icon in the UI. */
  is_townhouse?: boolean;
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
  language: string[]; // picklist apartment.language, multi-select (fixes51 §2.2)
  name: string | null; // resident name
  phone: string | null;
  email: string | null;
  /** fixes19: linked report number (מספר דוח). */
  report_number_id?: number | null;
  /** fixes19 §3 versioning: false = a historical (read-only) snapshot. */
  is_display?: boolean;
  last_edit?: string | null;
  root_id?: number | null;
  /** fixes32 §5: any apartment.* picklist beyond the 4 fixed fields above —
   *  keyed by field_key (e.g. "apartment.diet"). Populated on every read;
   *  written back via ApartmentUpdate.picklist_values. */
  picklist_values?: Record<string, string | null>;
  /** fixes35: any apartment custom field beyond select-type ones (which ride
   *  picklist_values instead) — keyed by field_key. */
  custom_field_values?: CustomFieldValueMap;
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
  // fixes53 §2: set only when sort="building" — distinct buildings matching
  // the current filters. Grouped view paginates by building (page_size =
  // buildings per page), so `items` always holds every apartment for the
  // buildings on this page, never a partial building.
  total_buildings?: number | null;
}

/** fixes23 §2: a distinct (report number → building) pair, driving the
 *  conditional building filter on the apartments page. */
export interface ReportNumberBuildingLink {
  report_number_id: number;
  building_id: number;
}

/** fixes23 §3: outcome of a bulk apartment update. */
export interface ApartmentBulkUpdateResult {
  updated: number;
}

/** fixes43 §1: outcome of a bulk contact "Assigned To" update. */
export interface ContactBulkUpdateResult {
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
 * Computed apartment title (fixes64 §1): "[floor] [apartment number]",
 * space-separated — floor "A" + number "2" → "A 2". Handles letter-based
 * floors combined with numeric apartment numbers unambiguously (the old
 * no-separator "[number][floor]" form, e.g. "2A", read as a single
 * apartment label instead of floor A's apartment 2). Both present → "A 2";
 * only one → that one; neither → resident name → id. Mirrors backend
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
  if (label && floor) return `${floor} ${label}`;
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
  torah_thought: string | null;
  /** fixes35: non-select visit custom field values — boolean-type ones still
   *  ride the legacy /custom-fields checkbox+note sub-resource instead.
   *  fixes39: this is also where connection_to_rebbe (now field_type="text")
   *  travels — it's no longer a dedicated field on this interface. */
  custom_field_values?: CustomFieldValueMap;
  /** fixes35 §5: any visit-scoped select custom field beyond visit_type/
   *  torah_thought (which keep their own dedicated fields above). */
  picklist_values?: Record<string, string | null>;
}

// fixes38 §1.2/§1.3: "Summary of Visits" report + per-contact Visit Summary.
export interface VisitSummaryItem {
  visit_id: number;
  visit_date: string;
  contact_id: number;
  contact_name: string;
}

export interface VisitSummaryCategory {
  /** fixes39: the field_key of the active entity_type="visit" boolean
   *  custom field this category summarizes — no longer a fixed union of the
   *  5 former Mivtzoim columns (any admin-added boolean checklist item now
   *  appears here too). */
  key: string;
  hebrew_label: string;
  english_label: string | null;
  count: number;
  items: VisitSummaryItem[];
}

export interface VisitSummaryOut {
  total: number;
  categories: VisitSummaryCategory[];
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
  // fixes37: "contact" | "contact_shliach" | "apartment" | "visit" |
  // "significant_date" — which logical entity this picklist belongs to.
  entity_type: string;
  // fixes40 round 2 §3: display order (shared surface with FieldSetting via
  // /api/field-settings). null = unordered.
  sort_order: number | null;
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
  /** fixes33 §6: free text injected at the top of every generated PDF report. */
  report_notes: string | null;
  /** fixes40 §4: global field-label text styling (null = app default). */
  label_font_size: number | null;
  label_color: string | null;
  label_font_family: string | null;
  /** fixes51 §4: the Shliach Role Configuration Panel's settings blob. */
  shliach_view_config?: Record<string, unknown> | null;
  /** fixes65 §1: public landing page + self-registration switch. */
  slug?: string | null;
  public_subtitle?: string | null;
  /** fixes85: English title + subtitle (null = use the Hebrew ones). */
  name_en?: string | null;
  public_subtitle_en?: string | null;
  public_gallery?: string[] | null;
  self_registration_enabled?: boolean;
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

/** fixes43 §4.2/4.3: a shliach already covering an area/report number —
 *  feeds the reassignment conflict warning on the shliach edit form. */
export interface ShliachSummary {
  id: number;
  name: string;
  last_name: string | null;
}

// --- fixes58: Campaign & Task entities --------------------------------------

export interface Campaign {
  id: number;
  guid: string;
  name: string;
  is_active: boolean;
  custom_stats_text: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// fixes71 §B: per-campaign apartment field hide/show — same shape as
// FieldSetting, apartment-only and keyed by campaign instead of org.
export interface CampaignFieldVisibility {
  field_key: string;
  label_key: string;
  entity: string;
  is_visible: boolean;
  label?: string | null;
  english_label?: string | null;
}

// fixes71 §B/§C: the org's one active campaign (or none) + which apartment
// fields it hides — what street2 shows an activist.
export interface CampaignActive {
  id: number;
  name: string;
  hidden_field_keys: string[];
}

// fixes72 §A: a completed building under a specific campaign — presence of
// a row means street2 hides it; admin DELETE undoes it.
export interface CampaignBuildingCompletion {
  building_id: number;
  building_label: string;
  completed_at: string;
  completed_by_name?: string | null;
}

// fixes72 §B: per-campaign change history, computed at read time from the
// apartment version chain — one entry per version row, with the fields that
// actually changed nested inside.
export interface CampaignHistoryFieldChange {
  field_key: string;
  label_key: string;
  label?: string | null;
  english_label?: string | null;
  field_type?: string | null;
  old_value: string | number | boolean | null;
  new_value: string | number | boolean | null;
}

export interface CampaignHistoryEntry {
  apartment_id: number;
  building_id: number;
  building_label: string;
  event: "created" | "edited";
  editor_name: string | null;
  changed_at: string;
  changes: CampaignHistoryFieldChange[];
}

export interface CampaignHistoryPage {
  items: CampaignHistoryEntry[];
  total: number;
  page: number;
  page_size: number;
}

/** fixes74 §2/§5: AVAILABLE = unassigned ("פנוי"), ACTIVE = taken ("נלקח"). */
export type TaskStatus = "AVAILABLE" | "ACTIVE" | "COMPLETED" | "PAUSED";

export interface Task {
  id: number;
  guid: string;
  campaign_id: number;
  campaign_name: string;
  /** fixes65 §2: null = orphan ("Assign Later") task. */
  volunteer_user_id: number | null;
  volunteer_name: string;
  custom_date_value_id: number | null;
  custom_date_value: string | null;
  report_number_ids: number[];
  report_number_names: string[];
  status: TaskStatus;
  volunteer_report_summary: string | null;
  // fixes60 §1: the volunteer's own most recent ShliachReportCompletion —
  // see backend routers/tasks.py::_latest_reports_by_volunteer.
  latest_report_status: ReportCompletionStatus | null;
  latest_report_notes: string | null;
  /** fixes65 §4: claim audit ('qr' | 'paper' | fixes74 'manual') + derived pool state. */
  claimed_at: string | null;
  claimed_via: string | null;
  /** fixes74 §11: when the current activist got the task. */
  assigned_at: string | null;
  is_orphan: boolean;
  apartment_count: number;
  /** fixes74 §1: the claim link's token; null once assigned manually (§4). */
  claim_token: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** fixes74 §3: POST /api/tasks/bulk/preview. */
export interface TaskBulkNumber {
  id: number;
  name: string;
  task_ids: number[];
}

export interface TaskBulkPreview {
  eligible: TaskBulkNumber[];
  conflicts: TaskBulkNumber[];
  missing: string[];
}

// --- fixes65: public landing page, QR claim, printing, paper entry ---------

export interface PublicOrg {
  id: number;
  slug: string;
  name: string;
  subtitle: string | null;
  /** fixes85: English variants — the page falls back to name/subtitle. */
  name_en?: string | null;
  subtitle_en?: string | null;
  logo_url: string | null;
  gallery: string[];
  self_registration_enabled: boolean;
}

export type ClaimState = "available" | "claimed" | "yours" | "taken" | "invalid";

export interface ClaimInfo {
  state: ClaimState;
  organization_id: number | null;
  organization_name: string | null;
  organization_slug: string | null;
  organization_logo_url: string | null;
  campaign_name: string | null;
  report_number_names: string[];
  apartment_count: number;
  /** fixes66 §2: a taken task that belongs to an activist (not the office). */
  has_activist: boolean;
}

export interface ClaimResult {
  state: ClaimState;
  task_id: number | null;
  detail: string | null;
}

export interface PublicRegisterResponse {
  access_token: string;
  claim_state: ClaimState | null;
}

export interface TaskPrintApartment {
  id: number;
  building_id: number;
  building_name: string | null;
  building_address: string | null;
  floor: string | null;
  apartment_name: string | null;
  name: string | null;
  report_number_name: string | null;
  jewish_status: string | null;
  mezuzah_status: string | null;
  language: string[];
  apartment_notes: string | null;
  /** fixes74 §9: the rest of the printable columns. */
  phone: string | null;
  email: string | null;
  campaign_status: string | null;
  area_name: string | null;
  picklist_values: Record<string, string | null>;
  custom_field_values: Record<string, string | number | boolean | null>;
}

export interface TaskPrintData {
  task: Task;
  claim_token: string | null;
  apartments: TaskPrintApartment[];
}

export type PerformerType = "user" | "name" | "unknown";

export interface PaperEntry {
  id: number;
  task_id: number;
  performer_type: PerformerType;
  performer_user_id: number | null;
  performer_name: string | null;
  entered_by_name: string | null;
  apartment_count: number;
  notes: string | null;
  created_at: string;
}

export interface TaskPage {
  items: Task[];
  total: number;
  page: number;
  page_size: number;
}

export interface CampaignActiveStat {
  id: number;
  name: string;
  custom_stats_text: string | null;
  count: number;
}

// fixes60 §2: campaign-task-status cells carry a task_id now, so the Report
// Numbers page's badge can become an inline PUT-able status toggle.
export interface TaskStatusWithId {
  status: TaskStatus;
  task_id: number;
}

/** fixes53 §3/§4: the "Number of Jews" / "Number of Engaged Jews"
 *  calculated columns on the Report Numbers/Areas grids. */
export interface JewishCounts {
  jews: number;
  engaged: number;
}

/** fixes68: one area associated with a report number (via its apartments'
 *  buildings) — powers the Report Numbers grid's optional Area column. */
export interface ReportNumberArea {
  id: number;
  area_name: string;
}

/** fixes53 §7/§9: an activist's "Report completed" self-edit submission —
 *  read on /dashboard/messages-from-activists. */
export type ReportCompletionStatus = "completed" | "not_completed" | "partial";
export interface ReportCompletion {
  id: number;
  guid: string;
  status: ReportCompletionStatus;
  comments: string | null;
  created_at: string;
  activist: ShliachSummary;
  /** fixes74 §11: the task the report is about (null = sent before the link existed). */
  task_id: number | null;
}

/** fixes74 §11: GET /api/shliach-messages/my-tasks — the report form's choices. */
export interface MyTask {
  id: number;
  campaign_name: string;
  report_number_names: string[];
  status: string;
  assigned_at: string | null;
}

/** fixes53 §7/§9: an activist's "Comments about the system" submission. */
export interface SystemComment {
  id: number;
  guid: string;
  comment: string;
  created_at: string;
  activist: ShliachSummary;
}

/** fixes54 §5/§6.1: an admin-authored announcement shown in the feed on an
 *  activist's dedicated landing page. */
export interface ShliachAnnouncement {
  id: number;
  guid: string;
  message_title: string;
  message_content: string;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

/** fixes45: one historical shliach version — the full snapshot plus who
 *  retired it and when (same shape as the Apartments history view). */
export interface ShliachVersion {
  id: number;
  contact_id: number;
  user_id: number | null;
  notes: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  report_number_ids: number[];
  area_ids: number[];
  last_edit: string | null;
  editor_name: string | null;
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

// --- fixes68 §1/§B1: activist door-to-door route ----------------------------

/** One door on an activist's route (GET /api/apartments/my-route) — carries
 *  every ApartmentListItem field (fixed columns, dynamic picklist_values,
 *  custom_field_values, linked contact), not a trimmed subset: an activist
 *  needs the same full picture an admin gets on the apartments grid.
 *  Pre-sorted server-side (hierarchy: report number -> building -> floor ->
 *  label); the client never re-sorts. */
export interface ApartmentRouteItem extends ApartmentListItem {
  last_outcome: DoorOutcome | null;
  last_outcome_at: string | null;
}

export type DoorOutcome =
  | "answered"
  | "not_home"
  | "jewish"
  | "not_jewish"
  | "come_back_later";

export interface DoorOutcomeResult {
  id: number;
  apartment_id: number;
  client_uuid: string;
  outcome: string;
  visit_date: string;
}

// --- Admin dashboard summary (GET /api/dashboard/summary) --------------------
export interface DashboardStat {
  value: number;
  previous_value: number;
}

export interface DashboardTrendPoint {
  date: string;
  contacts: number;
  apartments: number;
}

export interface DashboardActivistActivity {
  user_id: number;
  name: string;
  edits: number;
}

export interface DashboardJewishStatusBreakdownItem {
  value: string | null;
  count: number;
}

export interface DashboardJewishStatusChange {
  apartment_id: number;
  label: string;
  building_address: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  editor_name: string | null;
}

export interface DashboardSummary {
  range_days: number;
  new_contacts: DashboardStat;
  new_apartments: DashboardStat;
  activist_edits: DashboardStat;
  jewish_status_changes: DashboardStat;
  trend: DashboardTrendPoint[];
  top_activists: DashboardActivistActivity[];
  jewish_status_breakdown: DashboardJewishStatusBreakdownItem[];
  recent_jewish_changes: DashboardJewishStatusChange[];
}


/** fixes74 §12: GET /api/street-activity/{user_id}. */
export interface StreetActivityEvent {
  id: number;
  event_type: "mark" | "unmark" | "building_complete" | string;
  apartment_id: number | null;
  building_id: number | null;
  building_label: string | null;
  label: string | null;
  occurred_at: string;
  synced_at: string;
}

export interface StreetActivity {
  user_id: number;
  full_name: string;
  last_sync_at: string | null;
  events: StreetActivityEvent[];
}
