// Phone + password validation for signup.

/** Accepts Israeli or US phone numbers (various separators allowed). */
export function isValidPhone(raw: string): boolean {
  const p = raw.replace(/[\s\-().]/g, "");
  // Israel: +972 or 0 prefix; mobile 05X######## or landline 0[2-489]#######
  const israel = /^(\+972|0)(5\d{8}|[2-489]\d{7})$/;
  // US: optional +1 then 10 digits
  const usa = /^(\+1)?\d{10}$/;
  return israel.test(p) || usa.test(p);
}

export const PHONE_HINT =
  "מספר טלפון ישראלי (לדוגמה 052-1234567) או אמריקאי (לדוגמה +1 415 555 0123).";

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
