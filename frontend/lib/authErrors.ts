import { ApiError } from "@/lib/api";

type T = (key: string, fallback?: string) => string;

/** Hebrew defaults for the backend's login-flow error codes (fixes75 §8).
 *  The real text comes from the localization table (seed.py LOCALIZATION),
 *  in the user's language; these only cover a table that hasn't loaded. */
const FALLBACKS: Record<string, string> = {
  "auth.error.invalid_credentials": "שם משתמש או סיסמה שגויים",
  "auth.error.not_verified": "עליך לאמת את כתובת האימייל לפני ההתחברות.",
  "auth.error.org_pending": "הארגון ממתין לאישור מנהל המערכת. נעדכן אותך במייל.",
  "auth.error.org_disabled": "הארגון הושבת. יש לפנות לתמיכה.",
  "auth.error.google_invalid": "ההתחברות עם Google נכשלה. נסו שוב.",
  "auth.error.google_no_user": "לא נמצא משתמש עם כתובת אימייל זו. יש להירשם או לקבל הזמנה תחילה.",
  "auth.error.account_suspended": "הכניסה שלך למערכת הושעתה. יש לפנות למנהל הארגון.",
  "auth.error.reset_link_invalid": "הקישור לאיפוס הסיסמה אינו תקף או שפג תוקפו.",
  "auth.error.password_weak": "הסיסמה חייבת לכלול לפחות 8 תווים, אות גדולה, אות קטנה וספרה.",
};

/** The text to show for a failed sign-in / password-reset request — always
 *  through t(), never the backend's raw (English) message. */
export function authErrorText(err: unknown, t: T): string {
  if (err instanceof ApiError && err.code) return t(err.code, FALLBACKS[err.code]);
  if (err instanceof TypeError) {
    return t("auth.error.network", "אין חיבור לשרת. בדקו את החיבור ונסו שוב.");
  }
  return t("auth.login_failed", "התחברות נכשלה");
}
