# fixes95 — translations page split by screen (tabs + dividers)

Requested 2026-10-01: tabs / dividers by page (contacts / users / visits /
apartments …) so the right text is easier to find.

- [x] `/dashboard/localization`: rows grouped by **screen**, from each key's
      prefix (the part before the first dot, e.g. `users.login_status` →
      משתמשים). 18 groups: אנשי קשר, משתמשים, ביקורים, דירות, בניינים, אזורים,
      משימות וקמפיינים, מסך הפעיל, דוחות, תרומות, לוח בקרה וחיפוש, רשימות ושדות,
      הגדרות, כניסה והרשמה, מנהל מערכת, הודעות שגיאה, תפריט, כללי (anything
      unmatched). Replaces the old grouping by internal category.
- [x] Tabs with counts + "הכל" (every group under its own divider heading);
      keys sorted inside a group.
- [x] Search works across all groups; tab counts follow the search and empty
      groups hide.
- [x] Tab labels + search placeholder are in the localization table
      (`loc.group.*`, `loc.search`, `loc.no_results`).

Live-verified (org 1, page enabled temporarily then switched back off):
"הכל (1554)", e.g. "משתמשים (42)", "הודעות שגיאה (189)"; the משתמשים tab shows
only `users.*`; searching "אימייל" → "הכל (40)" with dividers per screen.
`tsc --noEmit` clean. Not committed.

Note: "כללי" (212) holds shared texts used on many screens (`page.*`,
`action.*`, `filter.*`, `date.*` …) — they don't belong to one screen.
