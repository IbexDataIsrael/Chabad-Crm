/**
 * fixes98: what the street2 celebration popup shows. Every 5 apartments an
 * activist finishes (first edit), the next item of ONE merged list is shown:
 * the regular celebration text (a Rebbe quote) and the admin's "messages for
 * activists" alternate — regular, message, regular, message, … — built once
 * on the client when the page first loads.
 */

/** Doors finished (first edit) between two celebrations. */
export const CELEBRATE_EVERY = 5;

export type CelebrationQuote = { id: number; he: string; en: string; ref: string };

export type CelebrationItem =
  | { kind: "quote"; quote: CelebrationQuote }
  | { kind: "message"; text: string };

export interface MessageStats {
  organization_name: string;
  number_of_apartments: number;
  number_of_jews: number;
}

/** Replace {organization_name} / {number_of_apartments} / {number_of_jews}.
 *  Unknown {names} are left as typed. */
export function fillPlaceholders(text: string, stats: MessageStats | null): string {
  if (!stats) return text;
  const values: Record<string, string> = {
    organization_name: stats.organization_name,
    number_of_apartments: stats.number_of_apartments.toLocaleString(),
    number_of_jews: stats.number_of_jews.toLocaleString(),
  };
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** Messages in the viewer's language; all of them when none match. */
export function messagesForLanguage<T extends { text: string; language: string }>(
  messages: readonly T[],
  lang: string,
): T[] {
  const own = messages.filter((m) => m.language === lang);
  return own.length > 0 ? own : [...messages];
}

/** Interleave: regular, message, regular, message, …  When one side runs
 *  out, the other continues alone. Either side may be empty. */
export function mergeCelebrationItems(
  quotes: readonly CelebrationQuote[],
  messages: readonly string[],
): CelebrationItem[] {
  const out: CelebrationItem[] = [];
  const n = Math.max(quotes.length, messages.length);
  for (let i = 0; i < n; i++) {
    if (i < quotes.length) out.push({ kind: "quote", quote: quotes[i] });
    if (i < messages.length) out.push({ kind: "message", text: messages[i] });
  }
  return out;
}

/** Fisher–Yates on a copy (quotes come in a fixed file order). */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
