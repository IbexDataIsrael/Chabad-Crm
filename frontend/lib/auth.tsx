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
  googleSignup as apiGoogleSignup,
  login as apiLogin,
  setToken,
} from "./api";

export interface Organization {
  id: number;
  name: string;
  map_in_english: boolean;
}

export interface User {
  id: number;
  username: string;
  full_name: string;
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
  signIn: (username: string, password: string) => Promise<void>;
  signInWithGoogle: (credential: string) => Promise<void>;
  signUpWithGoogle: (credential: string, organizationName: string) => Promise<void>;
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

  async function signIn(username: string, password: string) {
    const token = await apiLogin(username, password);
    setToken(token);
    setUser(await apiFetch<User>("/api/auth/me"));
  }

  async function signInWithGoogle(credential: string) {
    const token = await apiGoogleLogin(credential);
    setToken(token);
    setUser(await apiFetch<User>("/api/auth/me"));
  }

  // Google signup: create the org + admin, then sign in immediately (no email step).
  async function signUpWithGoogle(credential: string, organizationName: string) {
    const token = await apiGoogleSignup(credential, organizationName);
    setToken(token);
    setUser(await apiFetch<User>("/api/auth/me"));
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
        signIn,
        signInWithGoogle,
        signUpWithGoogle,
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
