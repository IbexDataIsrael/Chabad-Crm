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
  first_visit: string | null;
  potential_next_step: string | null;
  rebbe_connection: string | null;
  recommendations: string | null;
  background: string | null;
}

export interface Shliach {
  id: number;
  contact_id: number;
  user_id: number | null;
  notes: string | null;
  apartment_ids: number[];
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
  phone: string;
  email: string | null;
  contact_type: ContactType;
  assigned_user_id: number | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  area: string | null;
  pipeline_status: string | null;
  color_tag: string | null;
  priority_score: number | null;
  created_at: string;
  updated_at: string;
  checklist?: Checklist | null;
  mekurav?: Mekurav | null;
  shliach?: Shliach | null;
  special_dates?: SignificantDate[];
}

export interface Area {
  id: number;
  guid: string;
  area_name: string;
  area_notes: string | null;
  area_polygon: string | null;
}

export interface Building {
  id: number;
  guid: string;
  area_id: number;
  building_name: string;
  building_address: string | null;
  longitude: number | null;
  latitude: number | null;
}

export interface Apartment {
  id: number;
  guid: string;
  building_id: number;
  apartment_name: string;
  apartment_notes: string | null;
}

export interface Interaction {
  id: number;
  contact_id: number;
  created_by: number;
  category: string;
  note: string;
  created_at: string;
}

export interface PicklistValue {
  id: number;
  field_key: string;
  value: string;
  hebrew_label: string;
  color_hint: string | null;
  sort_order: number;
  is_active: boolean;
  is_default: boolean;
}

export interface PicklistField {
  field_key: string;
  label: string;
}

export interface OrgDetails {
  id: number;
  name: string;
  map_in_english: boolean;
}

export interface UserSummary {
  id: number;
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

/** Boolean mitzvot fields, in display order. */
export const CHECKLIST_BOOLEANS: (keyof Checklist)[] = [
  "tefillin",
  "tzedakah",
  "shabbat_candles",
  "torah_pamphlet",
  "torah_letter",
];
