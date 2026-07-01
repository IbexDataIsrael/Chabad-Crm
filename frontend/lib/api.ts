// API client: base URL, token storage, header injection, and 401 handling.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
const TOKEN_KEY = "crm_token";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
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

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined" && window.location.pathname !== "/") {
      window.location.href = "/";
    }
    throw new ApiError(401, "Unauthorized");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
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

/** Google Identity Services login: exchange a Google ID token for our JWT. */
export async function googleLogin(credential: string): Promise<string> {
  const data = await apiFetch<{ access_token: string }>("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
  return data.access_token;
}

/** Google signup: create a new org + admin from a Google identity, return our JWT. */
export async function googleSignup(
  credential: string,
  organizationName: string,
  organizationLogoUrl?: string | null,
): Promise<string> {
  const data = await apiFetch<{ access_token: string }>("/api/auth/google-signup", {
    method: "POST",
    body: JSON.stringify({
      credential,
      organization_name: organizationName,
      organization_logo_url: organizationLogoUrl ?? null,
    }),
  });
  return data.access_token;
}

/** OAuth2 password-flow login. Returns the access token. */
export async function login(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({ username, password });
  const res = await fetch(`${API_URL}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    let detail = "התחברות נכשלה";
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, detail);
  }
  const data = await res.json();
  return data.access_token as string;
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
  created_at: string;
  user_count: number;
  admin_email: string | null;
  admin_name: string | null;
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
}

export const adminCreateOrg = (payload: AdminOrgCreate): Promise<AdminOrganization> =>
  apiFetch("/api/admin/organizations", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const adminListOrganizations = (): Promise<AdminOrganization[]> =>
  apiFetch("/api/admin/organizations");

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

export const adminListUsers = (): Promise<AdminUser[]> => apiFetch("/api/admin/users");

export const adminDeleteUser = (userId: number): Promise<void> =>
  apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" });

export const adminDeactivateUser = (userId: number): Promise<AdminUser> =>
  apiFetch(`/api/admin/users/${userId}/deactivate`, { method: "POST" });

export const adminActivateUser = (userId: number): Promise<AdminUser> =>
  apiFetch(`/api/admin/users/${userId}/activate`, { method: "POST" });

export const adminVerifyUser = (userId: number): Promise<AdminUser> =>
  apiFetch(`/api/admin/users/${userId}/verify`, { method: "POST" });
