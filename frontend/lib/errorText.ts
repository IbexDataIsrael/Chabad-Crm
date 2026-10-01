/** fixes94: every API error shown to a user goes through the localization
 *  table (category "error"), in the user's language.
 *
 *  - A plain backend message ("Email already registered") is looked up by
 *    `errorKey(message)` → "error.email_already_registered" — the SAME key the
 *    backend seeds (backend/app/error_localization.py error_key()).
 *  - A coded error ({code, message, params} from app.core.errors.api_error, or
 *    the login errors' {code, message}) is shown as t(code) with {params}
 *    filled in.
 *  Unknown keys fall back to the server's own text, so nothing is ever lost.
 *
 *  The LocalizationProvider registers its translator here; api.ts calls
 *  `localizeError` for every failed response, so all callers that show
 *  `err.message` get the translated text without changes. */

type Translator = (key: string, fallback: string) => string;

let translator: Translator | null = null;

export function registerErrorTranslator(fn: Translator | null): void {
  translator = fn;
}

/** MUST match backend error_key(): lowercase, every run of non [a-z0-9] → "_",
 *  trimmed, max 80 chars. */
export function errorKey(message: string): string {
  const slug = message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80)
    .replace(/_+$/, "");
  return `error.${slug}`;
}

function fill(text: string, params: unknown): string {
  if (!params || typeof params !== "object") return text;
  return Object.entries(params as Record<string, unknown>).reduce(
    (acc, [k, v]) => acc.split(`{${k}}`).join(v == null ? "" : String(v)),
    text,
  );
}

/** The text to show for an API error: translated when the table has it. */
export function localizeError(message: string, body?: unknown): string {
  if (!translator) return message;
  const b = (body && typeof body === "object" ? body : {}) as {
    code?: unknown;
    params?: unknown;
  };
  if (typeof b.code === "string" && b.code) {
    return fill(translator(b.code, message), b.params);
  }
  if (!message) return message;
  return translator(errorKey(message), message);
}
