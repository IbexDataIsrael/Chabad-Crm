/** Quick-communication link builders (fixes15 §5.2 / fixes17 §2.1) — shared
 * by the contacts grid and the single-contact view. */

/** `tel:` link (dialers accept the local format as-is). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** WhatsApp deep link — wa.me wants an international number without '+'.
 *  Israeli local numbers (leading 0) become 972…; others pass through. */
export function waHref(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return `https://wa.me/${digits}`;
}
