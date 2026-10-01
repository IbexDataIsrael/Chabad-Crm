// API client: base URL, token storage, header injection, and 401 handling.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
const TOKEN_KEY = "crm_token";

import { localizeError } from "@/lib/errorText";

export class ApiError extends Error {
  status: number;
  /** fixes33 §2: the raw parsed JSON error body, when the response had one and
   * `detail` wasn't a plain string (e.g. a structured 409 conflict payload).
   * `Error`'s message would otherwise stringify a non-string detail into the
   * useless "[object Object]", losing the data callers need to branch on. */
  body?: unknown;
  /** fixes75 §8: a localization key the backend attaches to login-flow
   * errors (`detail: {code, message}`) — shown via t(code), never raw. */
  code?: string;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    const code = (body as { code?: unknown } | undefined)?.code;
    if (typeof code === "string") this.code = code;
  }
}

/** Parse a failed response's `detail`: a plain string, fixes75's / fixes94's
 * `{code, message, params}` object, or a validation (422) list. fixes94: the
 * message is translated through the localization table (lib/errorText) —
 * every caller that shows `err.message` gets the user's language. */
async function readErrorDetail(
  res: Response,
  fallback: string,
): Promise<{ message: string; body?: unknown }> {
  try {
    const data = await res.json();
    const detail = data?.detail;
    if (typeof detail === "string") return { message: localizeError(detail) };
    if (Array.isArray(detail) && detail.length > 0) {
      // Pydantic validation: "Value error, Invalid email address" → the message.
      const first = detail[0] as { msg?: unknown };
      const msg =
        typeof first?.msg === "string" ? first.msg.replace(/^Value error, /, "") : fallback;
      return { message: localizeError(msg), body: detail };
    }
    if (detail && typeof detail === "object") {
      const message = typeof detail.message === "string" ? detail.message : fallback;
      return { message: localizeError(message, detail), body: detail };
    }
  } catch {
    /* not JSON */
  }
  return { message: localizeError(fallback) };
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

// Device-level "someone has logged in here before" flag — set on every
// successful login/registration, deliberately NOT cleared by clearToken()
// (and not under the "crm." prefix its logout sweep removes), so a returning
// activist's /org/<slug> page opens on the sign-in tab instead of register.
const HAS_LOGGED_IN_KEY = "crm_has_logged_in";

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
  try {
    window.localStorage.setItem(HAS_LOGGED_IN_KEY, "1");
  } catch {
    // storage full/blocked — the flag is only a UX nicety
  }
}

export function hasLoggedInBefore(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HAS_LOGGED_IN_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  // fixes58: every list/grid page's filters/sort/columns/paging persist via
  // usePersistentState under a plain "crm.<page>.*" localStorage key — with
  // no per-account namespacing, so on a shared/reused browser (e.g. someone
  // else logged in on this device before) the next account silently inherits
  // the previous one's filter values (a building/area id that doesn't exist
  // for them, etc.), making a page look empty even though an unfiltered
  // summary count elsewhere is correct. Sweep them on every session end so
  // the next login starts clean. "crm.pref.*" is excluded on purpose — those
  // already follow the account via the server (useDbPreference) and
  // reconcile on load, they aren't device-local state.
  for (let i = window.localStorage.length - 1; i >= 0; i--) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith("crm.") && !key.startsWith("crm.pref.")) {
      window.localStorage.removeItem(key);
    }
  }
}

/** Upload an image to our backend, which stores it on Cloudinary and returns the
 * secure URL. Multipart (not JSON), so it doesn't go through apiFetch. */
export async function uploadLogo(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/uploads/logo`, {
    method: "POST",
    body: form,
    headers,
  });
  if (!res.ok) {
    let detail = "Logo upload failed";
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, detail);
  }
  const data = await res.json();
  return data.url as string;
}

/** fixes56 §2: upload one image into the caller's org-scoped announcement
 * gallery (admin-only backend endpoint). Mirrors `uploadLogo` — multipart,
 * not JSON, so it bypasses apiFetch. */
export async function uploadAnnouncementImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/uploads/announcement-image`, {
    method: "POST",
    body: form,
    headers,
  });
  if (!res.ok) {
    let detail = "Image upload failed";
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, detail);
  }
  const data = await res.json();
  return data.url as string;
}

/** Authenticated file download: fetches `path` with the Bearer token (a plain
 * <a href> can't carry it) and hands the blob to the browser as a download.
 * The filename comes from Content-Disposition, falling back to `fallback`. */
export async function apiDownload(path: string, fallback: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? fallback;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// The Render free/starter backend spins down after idling and, while it's
// booting back up, Render's own edge proxy returns 502/503/504 (or the
// request fails at the network level entirely — a CORS preflight against a
// 502 surfaces to the browser as a plain "Failed to fetch") until the app
// process is actually listening. That's transient, not a real error, but
// every page's silently-caught "empty" state used to treat it exactly like
// one (see docs/fixes58.md-adjacent apartments-page fix). Retry a GET a few
// times with backoff before giving up — covers the common few-seconds-long
// wake-up without masking a genuinely down/broken backend forever. Mutating
// requests are never auto-retried (a lost response to a POST that actually
// reached the app would double-submit).
const RETRY_DELAYS_MS = [1000, 3000, 6000, 10000];

function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Authenticated JSON fetch. Throws ApiError on non-2xx; redirects to login on 401. */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const method = (options.method ?? "GET").toUpperCase();
  const retryable = method === "GET";

  let res: Response;
  let attempt = 0;
  for (;;) {
    try {
      res = await fetch(`${API_URL}${path}`, { ...options, headers });
    } catch (networkErr) {
      if (retryable && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        attempt++;
        continue;
      }
      throw networkErr;
    }
    if (retryable && isRetryableStatus(res.status) && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      attempt++;
      continue;
    }
    break;
  }

  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined" && window.location.pathname !== "/") {
      window.location.href = "/";
    }
    // fixes75 §8: keep a login-flow error code (e.g. an invalid Google token).
    const { body } = await readErrorDetail(res, "Unauthorized");
    throw new ApiError(401, "Unauthorized", body);
  }

  if (!res.ok) {
    const { message, body } = await readErrorDetail(res, res.statusText);
    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface LocalizationRow {
  id: number;
  entity_type: string;
  technical_name: string;
  hebrew_label: string;
  english_label: string | null;
}

/** Admin: list all UI localization strings. */
export async function listLocalization(): Promise<LocalizationRow[]> {
  return apiFetch("/api/localization");
}

/** Admin: update a localization string's Hebrew/English text. */
export async function updateLocalization(
  id: number,
  patch: { hebrew_label?: string; english_label?: string | null },
): Promise<LocalizationRow> {
  return apiFetch(`/api/localization/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export interface SignupPayload {
  organization_name: string;
  organization_logo_url?: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  username: string;
  password: string;
}

export async function signup(
  payload: SignupPayload,
): Promise<{ status: string; email?: string; access_token?: string }> {
  return apiFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function verifyEmail(
  token: string,
): Promise<{ status: string; organization_id: number }> {
  return apiFetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
}

export async function resendVerification(email: string): Promise<void> {
  await apiFetch("/api/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** fixes14: one email may belong to several organizations — login then returns
 * the list to pick from instead of a token, and the client retries with the
 * chosen `organization_id`. */
export interface LoginOrgOption {
  id: number;
  name: string;
  logo_url: string | null;
}

export interface LoginResult {
  access_token: string | null;
  requires_org_selection: boolean;
  organizations: LoginOrgOption[];
}

/** Google Identity Services login: exchange a Google ID token for our JWT
 * (or an organization-selection list — see LoginResult). */
export async function googleLogin(
  credential: string,
  organizationId?: number,
): Promise<LoginResult> {
  return apiFetch<LoginResult>("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential, organization_id: organizationId ?? null }),
  });
}

/** Google signup: register a new org for approval from a Google identity (no login). */
export async function googleSignup(
  credential: string,
  organizationName: string,
  organizationLogoUrl?: string | null,
): Promise<{ status: string; email?: string }> {
  return apiFetch("/api/auth/google-signup", {
    method: "POST",
    body: JSON.stringify({
      credential,
      organization_name: organizationName,
      organization_logo_url: organizationLogoUrl ?? null,
    }),
  });
}

/** OAuth2 password-flow login. Returns the access token — or an
 * organization-selection list when the identity spans several orgs (fixes14). */
export async function login(
  username: string,
  password: string,
  organizationId?: number,
): Promise<LoginResult> {
  const body = new URLSearchParams({ username, password });
  if (organizationId != null) body.set("organization_id", String(organizationId));
  const res = await fetch(`${API_URL}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const { message, body } = await readErrorDetail(res, "Login failed");
    throw new ApiError(res.status, message, body);
  }
  return (await res.json()) as LoginResult;
}

/** Change the logged-in user's own password. */
export const changePassword = (
  currentPassword: string,
  newPassword: string,
): Promise<{ status: string }> =>
  apiFetch("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });

// --- Platform superadmin (/admin dashboard) --------------------------------
export interface AdminOrganization {
  id: number;
  guid: string;
  name: string;
  is_active: boolean;
  approval_status: string;
  created_at: string;
  user_count: number;
  admin_email: string | null;
  admin_name: string | null;
  /** fixes82: hosts a superadmin account → can't be deleted/disabled/impersonated. */
  is_system: boolean;
  superadmin_usernames: string[];
}

export interface AdminUser {
  id: number;
  guid: string;
  username: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
  organization_id: number;
}

export interface AdminOrgCreate {
  organization_name: string;
  admin_email: string;
  admin_full_name: string;
  admin_username: string;
  admin_password: string;
  /** Clone only: caps how many rows are copied for one or more tables
   *  (keyed by table name, e.g. {apartments: 500}). Ignored by plain org
   *  creation (adminCreateOrg). */
  table_row_limits?: Record<string, number>;
  /** fixes87: demo clone — the activist ids a clone-plan preview chose, and
   *  the password for their made-up demo logins. */
  demo_activist_user_ids?: number[];
  demo_password?: string;
}

/** fixes87: the preview of a demo clone (nothing written yet). */
export interface ClonePlan {
  available_activists: number;
  activists: { user_id: number; full_name: string; task_count: number; apartment_count: number }[];
  apartment_count: number;
  building_count: number;
}

export interface CloneResult extends AdminOrganization {
  clone_activists: number;
  clone_apartments: number;
  clone_tasks: number;
  demo_logins: { username: string; full_name: string | null }[];
}

export const adminClonePlan = (
  orgId: number,
  activistCount: number,
  apartmentTarget: number,
): Promise<ClonePlan> =>
  apiFetch(`/api/admin/organizations/${orgId}/clone-plan`, {
    method: "POST",
    body: JSON.stringify({ activist_count: activistCount, apartment_target: apartmentTarget }),
  });

export const adminCreateOrg = (payload: AdminOrgCreate): Promise<AdminOrganization> =>
  apiFetch("/api/admin/organizations", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const adminListOrganizations = (): Promise<AdminOrganization[]> =>
  apiFetch("/api/admin/organizations");

/** Copies an org's entire CRM data set into a brand-new organization (with a
 * fresh admin login) — for sample/demo/sandbox copies. The source org is
 * never modified. Same payload shape as adminCreateOrg: organization_name is
 * the new (clone) org's name, not the source's. */
export const adminCloneOrg = (
  orgId: number,
  payload: AdminOrgCreate,
): Promise<CloneResult> =>
  apiFetch(`/api/admin/organizations/${orgId}/clone`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const adminListOrgUsers = (orgId: number): Promise<AdminUser[]> =>
  apiFetch(`/api/admin/organizations/${orgId}/users`);

export const adminDeactivateOrg = (orgId: number): Promise<AdminOrganization> =>
  apiFetch(`/api/admin/organizations/${orgId}/deactivate`, { method: "POST" });

export const adminActivateOrg = (orgId: number): Promise<AdminOrganization> =>
  apiFetch(`/api/admin/organizations/${orgId}/activate`, { method: "POST" });

export const adminDeleteOrg = (orgId: number): Promise<void> =>
  apiFetch(`/api/admin/organizations/${orgId}`, { method: "DELETE" });

export const adminImpersonateOrg = (orgId: number): Promise<{ access_token: string }> =>
  apiFetch(`/api/admin/organizations/${orgId}/impersonate`, { method: "POST" });

export const adminApproveOrg = (orgId: number): Promise<AdminOrganization> =>
  apiFetch(`/api/admin/organizations/${orgId}/approve`, { method: "POST" });

// fixes54 §8: superadmin-managed per-org feature toggles.
export interface OrgPrefs {
  raw: Record<string, boolean>;
  effective: Record<string, boolean>;
}
export type OrgPrefsUpdate = Partial<{
  area_display_enabled: boolean;
  building_display_enabled: boolean;
  apartment_display_enabled: boolean;
  activist_system_enabled: boolean;
  ai_query_enabled: boolean;
  localization_page_enabled: boolean;
}>;

export const adminGetOrgPrefs = (orgId: number): Promise<OrgPrefs> =>
  apiFetch(`/api/admin/organizations/${orgId}/prefs`);

export const adminUpdateOrgPrefs = (
  orgId: number,
  updates: OrgPrefsUpdate,
): Promise<OrgPrefs> =>
  apiFetch(`/api/admin/organizations/${orgId}/prefs`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });

export interface EmailTemplate {
  id: number;
  key: string;
  subject: string;
  body: string;
  body_hebrew: string;
}

export const adminListEmailTemplates = (): Promise<EmailTemplate[]> =>
  apiFetch("/api/admin/email-templates");

export const adminUpdateEmailTemplate = (
  key: string,
  patch: { subject?: string; body?: string; body_hebrew?: string },
): Promise<EmailTemplate> =>
  apiFetch(`/api/admin/email-templates/${key}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });

export const adminListUsers = (): Promise<AdminUser[]> => apiFetch("/api/admin/users");

/** What still points at a user (fixes15 §2.2 delete-confirm modal). */
export interface AdminUserDependencies {
  assigned_contacts: number;
  assigned_tasks?: number;
  interactions: number;
  shliach_contact_id: number | null;
  shliach_contact_name: string | null;
  covered_report_numbers: number; // fixes19 (was covered apartments)
  covered_areas: number;
  has_dependencies: boolean;
}

export const adminUserDependencies = (
  userId: number,
): Promise<AdminUserDependencies> =>
  apiFetch(`/api/admin/users/${userId}/dependencies`);

export const adminDeleteUser = (userId: number): Promise<void> =>
  apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" });

export const adminDeactivateUser = (userId: number): Promise<AdminUser> =>
  apiFetch(`/api/admin/users/${userId}/deactivate`, { method: "POST" });

export const adminActivateUser = (userId: number): Promise<AdminUser> =>
  apiFetch(`/api/admin/users/${userId}/activate`, { method: "POST" });

/** fixes75 §3: the superadmin sets a new password for a user. */
export const adminResetUserPassword = (userId: number, newPassword: string): Promise<AdminUser> =>
  apiFetch(`/api/admin/users/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ new_password: newPassword }),
  });

export const adminVerifyUser = (userId: number): Promise<AdminUser> =>
  apiFetch(`/api/admin/users/${userId}/verify`, { method: "POST" });

// --- Global search ----------------------------------------------------------
export type SearchHitType = "contact" | "user" | "area" | "building" | "apartment";

export interface SearchHit {
  type: SearchHitType;
  id: number;
  title: string;
  subtitle: string | null;
  contact_type: "mekurav" | "shliach" | null;
}

export const globalSearch = (q: string): Promise<{ query: string; results: SearchHit[] }> =>
  apiFetch(`/api/search?q=${encodeURIComponent(q)}`);

// --- AI query (natural language -> data grid) --------------------------------
export interface AiQueryColumn {
  key: string;
  label_he: string;
  label_en: string;
}

export interface AiQueryResponse {
  table_title: string;
  columns: AiQueryColumn[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
}

export const aiQuery = (prompt: string): Promise<AiQueryResponse> =>
  apiFetch("/api/ai/query", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });

/** fixes65 §1: upload one photo into the org's public landing-page gallery
 * (admin-only, org-scoped — same storage path as announcement images). */
export async function uploadGalleryImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api/uploads/gallery-image`, {
    method: "POST",
    body: form,
    headers,
  });
  if (!res.ok) {
    let detail = "Image upload failed";
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, detail);
  }
  const data = await res.json();
  return data.url as string;
}
