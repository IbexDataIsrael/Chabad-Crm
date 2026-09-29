"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  apiFetch,
  clearToken,
  getToken,
  googleLogin as apiGoogleLogin,
  login as apiLogin,
  setToken,
  type LoginOrgOption,
} from "./api";
import type { Shliach } from "./types";

export type { LoginOrgOption };

export interface Organization {
  id: number;
  name: string;
  logo_url: string | null;
  map_in_english: boolean;
  default_lat: number | null;
  default_lng: number | null;
  default_zoom: number;
  /** fixes18 §6: may shliach users view (mekurav) contacts? Default false. */
  shliach_can_view_contacts?: boolean;
  /** fixes33 §6: free text injected at the top of every generated PDF report. */
  report_notes?: string | null;
  /** fixes40 §4: global field-label text styling (null/unset = app default). */
  label_font_size?: number | null;
  label_color?: string | null;
  label_font_family?: string | null;
  /** fixes51 §4: the Shliach Role Configuration Panel's settings blob. */
  shliach_view_config?: ShliachViewConfig | null;
  /** fixes54 §8: this org's cascaded feature-toggle flags, set by the
   *  superadmin (/dashboard/admin) — area_display_enabled/
   *  building_display_enabled/apartment_display_enabled/
   *  activist_system_enabled/ai_query_enabled. A key absent here (e.g. a
   *  cached session from before this shipped) should read as enabled. */
  feature_flags?: Record<string, boolean>;
  /** fixes65 §1: public landing page (/org/<slug>) + self-registration. */
  slug?: string | null;
  public_subtitle?: string | null;
  public_gallery?: string[] | null;
  self_registration_enabled?: boolean;
}

/** fixes54 §8: reads one of `Organization.feature_flags` — missing/absent
 *  (an older cached session, or a key added after this shipped) reads as
 *  enabled, only an explicit `false` disables. Shared by the sidebar nav
 *  and every module's own page-level guard so they can never disagree. */
export function isFeatureEnabled(
  org: Organization | null | undefined,
  key: string,
): boolean {
  return org?.feature_flags?.[key] !== false;
}

/** fixes51 §4: org-wide config for the Shliach role's Apartments experience —
 *  set from /dashboard/shliach-config (admin-only), consumed by the
 *  Apartments page for isShliach users. */
export interface ShliachViewConfig {
  disable_edit?: boolean;
  hide_filters?: boolean;
  default_filters?: Record<string, unknown>;
  default_columns?: string[] | null;
  /** fixes53 §7/§8: field keys an admin locked on top of the mandatory
   *  self-edit locks (email / shliach.areas / shliach.report_numbers) —
   *  set from /dashboard/shliach-config, consumed by ContactView's
   *  "Edit your data" self-edit mode. */
  self_edit_locked_fields?: string[];
  /** fixes54 §6: Apartment field keys (FIELD_KEYS on the Apartments page)
   *  an activist can't inline-edit — the "Edit Lock" section on
   *  /dashboard/shliach-config. Distinct from self_edit_locked_fields above,
   *  which locks the activist's own contact profile, not apartment data. */
  apartment_edit_locked_fields?: string[];
  /** fixes54 §6: hides the Apartments page's "Customize fields" column
   *  picker entirely from activists. */
  customize_fields_locked?: boolean;
  /** fixes74 §13: the order of the fields in street2's apartment card —
   *  visibility keys (apartments.name, apartment.Jewish_status, a custom
   *  picklist's field_key, customfield.apartment.<key>). */
  street2_field_order?: string[];
}

export interface User {
  id: number;
  guid: string; // contact-assignment key (fixes10/11)
  username: string;
  full_name: string;
  /** fixes14: full name resolved from the linked contacts row (navbar). */
  display_name?: string | null;
  email?: string | null;
  role: string;
  created_at: string;
  organization_id: number;
  organization?: Organization | null;
  // fixes52 §5: the linked ContactShliach (role='shliach' only) — mirrors
  // schemas.UserOut.shliach, already returned by GET /api/auth/me but never
  // exposed on this type before now.
  shliach?: Shliach | null;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isShliach: boolean;
  isSuperadmin: boolean;
  /** fixes58 §3.7: the Campaign Manager role — full Apartments/Tasks/
   *  Campaigns/Volunteers/shliach-config management, blocked from Contacts/
   *  Visits/global System Settings. */
  isCampaignManager: boolean;
  /** Resolves to null when logged in, or to the organization list when the
   * identity spans several orgs and one must be chosen (fixes14). */
  signIn: (
    username: string,
    password: string,
    organizationId?: number,
  ) => Promise<LoginOrgOption[] | null>;
  signInWithGoogle: (
    credential: string,
    organizationId?: number,
  ) => Promise<LoginOrgOption[] | null>;
  signUp: (username: string, fullName: string, password: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
  /** fixes65: adopt a token issued outside the login endpoints (public
   *  self-registration returns one directly). */
  signInWithToken: (token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from a stored token on first load.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    apiFetch<User>("/api/auth/me")
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  async function signIn(
    username: string,
    password: string,
    organizationId?: number,
  ): Promise<LoginOrgOption[] | null> {
    const result = await apiLogin(username, password, organizationId);
    if (result.requires_org_selection) return result.organizations;
    setToken(result.access_token!);
    setUser(await apiFetch<User>("/api/auth/me"));
    return null;
  }

  async function signInWithGoogle(
    credential: string,
    organizationId?: number,
  ): Promise<LoginOrgOption[] | null> {
    const result = await apiGoogleLogin(credential, organizationId);
    if (result.requires_org_selection) return result.organizations;
    setToken(result.access_token!);
    setUser(await apiFetch<User>("/api/auth/me"));
    return null;
  }

  // Public self-registration creates a staff user, then signs them in.
  async function signUp(username: string, fullName: string, password: string) {
    await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        full_name: fullName,
        password,
        role: "staff",
      }),
    });
    await signIn(username, password);
  }

  async function signInWithToken(token: string) {
    setToken(token);
    setUser(await apiFetch<User>("/api/auth/me"));
  }

  function signOut() {
    // fixes69 Bug 3: land on the org's own page (self-registration/sign-in),
    // not the generic root — org-scoped from the session that's ending, so a
    // shared-org staff member's browser doesn't need a bookmark for it.
    const orgSlug = user?.organization?.slug;
    clearToken();
    setUser(null);
    if (typeof window !== "undefined") {
      window.location.href = orgSlug ? `/org/${orgSlug}` : "/";
    }
  }

  async function refresh() {
    if (!getToken()) return;
    try {
      setUser(await apiFetch<User>("/api/auth/me"));
    } catch {
      /* ignore */
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin: user?.role === "admin",
        isShliach: user?.role === "shliach",
        isSuperadmin: user?.role === "superadmin",
        isCampaignManager: user?.role === "campaign_manager",
        signIn,
        signInWithGoogle,
        signUp,
        signOut,
        refresh,
        signInWithToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
