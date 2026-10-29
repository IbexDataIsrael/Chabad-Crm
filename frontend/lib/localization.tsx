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
import { registerErrorTranslator } from "@/lib/errorText";
import { useAuth } from "./auth";

export type Lang = "he" | "en";
const LANG_KEY = "crm_lang";
// fixes116: set when the toggle is pressed while logged out — an explicit
// choice made before login, saved to the account once the session resolves.
// crm_lang alone is only a passive display fallback and is never saved.
const EXPLICIT_LANG_KEY = "crm_lang_explicit";

function isLang(v: unknown): v is Lang {
  return v === "he" || v === "en";
}

function saveLocale(lang: Lang): Promise<unknown> {
  return apiFetch("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ key: "locale", value: lang }),
  });
}

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
  const { user } = useAuth();
  const [data, setData] = useState<LocalizationMap>({});
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>("he");

  // Restore the saved language before paint (works pre-login too).
  useEffect(() => {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (isLang(saved)) setLangState(saved);
  }, []);

  // fixes17 §1.1: the language preference lives in the DB per user — once a
  // session resolves, the account's stored locale wins over this browser's.
  // fixes116: unless the user toggled the language before logging in — that
  // explicit choice wins and is saved. The mark is cleared only once the save
  // succeeds, so a failed save is retried on the next load.
  useEffect(() => {
    if (!user) return;
    const explicit = window.sessionStorage.getItem(EXPLICIT_LANG_KEY);
    if (isLang(explicit)) {
      setLangState(explicit);
      window.localStorage.setItem(LANG_KEY, explicit);
      saveLocale(explicit)
        .then(() => window.sessionStorage.removeItem(EXPLICIT_LANG_KEY))
        .catch(() => {});
      return;
    }
    apiFetch<Record<string, unknown>>("/api/preferences")
      .then((prefs) => {
        const locale = prefs["locale"];
        if (isLang(locale)) {
          setLangState(locale);
          window.localStorage.setItem(LANG_KEY, locale);
        }
      })
      .catch(() => {});
  }, [user]);

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

  // Only called from an explicit switch (LanguageToggle) — never for a
  // passive fallback, so a browser default is never written to the account.
  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      window.localStorage.setItem(LANG_KEY, next);
      if (user) {
        // fixes17 §1.1: persist the choice on the account. Non-blocking: if
        // the save fails the screen keeps the chosen language.
        window.sessionStorage.removeItem(EXPLICIT_LANG_KEY);
        saveLocale(next).catch(() => {});
      } else {
        // fixes116: logged out — remember it was explicit; saved after login.
        window.sessionStorage.setItem(EXPLICIT_LANG_KEY, next);
      }
    },
    [user],
  );

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

  // fixes94: API error messages are translated centrally (lib/errorText) —
  // give it the current translator.
  useEffect(() => {
    registerErrorTranslator((key, fallback) => value.t(key, fallback));
    return () => registerErrorTranslator(null);
  }, [value]);

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
