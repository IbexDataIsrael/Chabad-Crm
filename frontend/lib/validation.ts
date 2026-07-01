// Phone + email + password validation.

/** Accepts an Israeli or a North-American (USA/Canada, NANP) phone number. */
export function isValidPhone(raw: string): boolean {
  const p = raw.replace(/[\s\-().]/g, "");
  // Israel: +972 or 0 prefix; mobile 05X######## or landline 0[2-489]#######
  const israel = /^(\+972|0)(5\d{8}|[2-489]\d{7})$/;
  // USA/Canada (NANP): optional +1, then 10 digits where area & exchange start 2-9.
  const nanp = /^(\+?1)?[2-9]\d{2}[2-9]\d{6}$/;
  return israel.test(p) || nanp.test(p);
}

export const PHONE_HINT =
  "מספר טלפון ישראלי (לדוגמה 052-1234567) או אמריקאי/קנדי (לדוגמה +1 415 555 0123).";

/** A pragmatic email check (one @, a dot in the domain, no spaces). */
export function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim());
}

export const EMAIL_HINT = "כתובת אימייל תקינה, לדוגמה name@example.com";

export interface PasswordCheck {
  length: boolean;
  upper: boolean;
  lower: boolean;
  digit: boolean;
}

export function checkPassword(pw: string): PasswordCheck {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
  };
}

/** "Medium" strength = all four requirements met. */
export function isMediumPassword(pw: string): boolean {
  const c = checkPassword(pw);
  return c.length && c.upper && c.lower && c.digit;
}

export const PASSWORD_HINT =
  "הסיסמה חייבת לכלול לפחות 8 תווים, אות גדולה (A-Z), אות קטנה (a-z) ומספר.";
