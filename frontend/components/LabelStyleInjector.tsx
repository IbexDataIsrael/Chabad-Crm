"use client";

import { useAuth } from "@/lib/auth";

/**
 * fixes40 §4: applies the org's global field-label text styling
 * (Settings → "עיצוב טקסט תוויות שדות") across the system.
 *
 * This codebase has no single shared label component — every page hand-
 * writes its own `<label>`/`<dt>` plus inline Tailwind classes — so there is
 * no one component to theme. The two markup patterns used consistently
 * throughout the app for "this is a field's label, not its value or input"
 * are a `<label>`'s first child `<span>` (e.g. `<label><span
 * className="...">קומה</span><input .../></label>`) and a bare `<dt>` (the
 * read-only detail views). Targeting exactly those two — not `label`/`dt`
 * themselves, which could also catch a sibling `<input>` nested inside the
 * same `<label>` — keeps this from accidentally restyling input text.
 *
 * `!important` is required, not optional: a directly-applied Tailwind
 * utility class on the label span (e.g. `text-sm`) always wins over an
 * inherited/cascaded value from an ancestor rule, regardless of selector
 * specificity — so overriding it means beating it, not just cascading past
 * it. Each property is only emitted when the org actually set it, so an
 * untouched org's styling is byte-for-byte unchanged.
 */
export function LabelStyleInjector() {
  const { user } = useAuth();
  const org = user?.organization;
  if (!org) return null;

  const labelRules: string[] = [];
  if (org.label_font_size) labelRules.push(`font-size: ${org.label_font_size}px !important;`);
  if (org.label_color) labelRules.push(`color: ${org.label_color} !important;`);

  const blocks: string[] = [];
  if (labelRules.length > 0) {
    blocks.push(`label > span:first-child, dt { ${labelRules.join(" ")} }`);
  }
  // fixes42 §3: the font-family choice must apply system-wide, not just to
  // field labels. `body` already reads `font-family: var(--font-sans)`
  // (globals.css) and nothing else in the app sets its own font-family, so
  // overriding the shared variable itself — rather than a label-scoped rule
  // — is what actually reaches ordinary body text everywhere.
  if (org.label_font_family) {
    blocks.push(
      `:root { --font-sans: "${org.label_font_family}", system-ui, "Segoe UI", "Arial Hebrew", "David", sans-serif; }`,
    );
  }
  if (blocks.length === 0) return null;

  return <style id="label-style-override">{blocks.join(" ")}</style>;
}
