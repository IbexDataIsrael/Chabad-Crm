"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { apiFetch } from "./api";

export type Lang = "he" | "en";
const LANG_KEY = "crm_lang";

// { technical_name: { he, en } }
type LocalizationMap = Record<string, { he: string; en: string }>;

interface LocalizationContextValue {
  loading: boolean;
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  /** Resolve a key to the current language (falls back to the other lang, then fallback, then key). */
  t: (key: string, fallback?: string) => string;
}

const LocalizationContext = createContext<LocalizationContextValue | undefined>(
  undefined,
);

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LocalizationMap>({});
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>("he");

  // Restore the saved language before paint.
  useEffect(() => {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (saved === "he" || saved === "en") setLangState(saved);
  }, []);

  // Reflect the language on <html> (dir + lang) so the whole app flips RTL/LTR.
  useEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = lang === "he" ? "rtl" : "ltr";
  }, [lang]);

  // Public endpoint — fetched at boot, before login.
  useEffect(() => {
    apiFetch<LocalizationMap>("/api/metadata/localization")
      .then(setData)
      .catch(() => setData({}))
      .finally(() => setLoading(false));
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(LANG_KEY, next);
  }, []);

  const value = useMemo<LocalizationContextValue>(() => {
    const other: Lang = lang === "he" ? "en" : "he";
    return {
      loading,
      lang,
      dir: lang === "he" ? "rtl" : "ltr",
      setLang,
      toggleLang: () => setLang(lang === "he" ? "en" : "he"),
      t: (key, fallback) => {
        const entry = data[key];
        if (entry) {
          // Prefer current language; fall back to the other if it's blank.
          if (entry[lang]) return entry[lang];
          if (entry[other]) return entry[other];
        }
        return fallback ?? key;
      },
    };
  }, [loading, lang, data, setLang]);

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization(): LocalizationContextValue {
  const ctx = useContext(LocalizationContext);
  if (!ctx) {
    throw new Error("useLocalization must be used within a LocalizationProvider");
  }
  return ctx;
}
