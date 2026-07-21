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
}

export interface User {
  id: number;
  guid: string; // contact-assignment key (fixes10/11)
  username: string;
  full_name: string;
  /** fixes14: full name resolved from the linked contacts row (navbar). */
  display_name?: string | null;
  role: string;
  created_at: string;
  organization_id: number;
  organization?: Organization | null;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isShliach: boolean;
  isSuperadmin: boolean;
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

  function signOut() {
    clearToken();
    setUser(null);
    if (typeof window !== "undefined") window.location.href = "/";
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
        signIn,
        signInWithGoogle,
        signUp,
        signOut,
        refresh,
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
