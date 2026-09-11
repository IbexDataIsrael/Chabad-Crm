"use client";

import { useEffect, useRef, useState } from "react";

import { useLocalization } from "@/lib/localization";

/**
 * Generic multi-select dropdown filter (fixes15 §4.1/§5.1/§7.1): a compact
 * button showing the selection summary that opens a checkbox list. An empty
 * selection means "all" (no filtering). Ids may be numbers (entity filters)
 * or strings (fixes17 §2.2 — e.g. mitzvah field names).
 */
export function MultiSelectFilter<Id extends number | string>({
  allLabel,
  label,
  options,
  value,
  onChange,
}: {
  /** Button text while nothing is selected, e.g. "כל האזורים". */
  allLabel: string;
  /** fixes56 §3: short, persistent filter name (e.g. "אזור") kept visible as
   *  a prefix once something is checked — otherwise the button text becomes
   *  just the selected value ("צפון") or a bare count ("2 נבחרו"), losing
   *  which filter that even is. Omit to keep the old (pre-fixes56) behavior
   *  for callers that haven't been given a short label yet. */
  label?: string;
  options: { id: Id; label: string }[];
  value: Id[];
  onChange: (ids: Id[]) => void;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  // fixes62 (follow-up): selected items float to the top, but only settle
  // there between dropdown sessions — the sort order is snapshotted the
  // moment the dropdown opens and held fixed while it stays open, so
  // checking an item mid-session doesn't yank it out from under the user's
  // scroll position. The next time they open it, the snapshot is refreshed
  // and anything they just checked floats up.
  const [frozenSelected, setFrozenSelected] = useState<Set<Id>>(new Set());

  // fixes18 §general: long entity lists (e.g. buildings) are typeable inline.
  const searchable = options.length > 8;
  const filtered = query.trim()
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;
  const visible = [...filtered].sort((a, b) => {
    const aFirst = frozenSelected.has(a.id) ? 0 : 1;
    const bFirst = frozenSelected.has(b.id) ? 0 : 1;
    return aFirst - bFirst;
  });

  useEffect(() => {
    if (open) setFrozenSelected(new Set(value));
    // Only resnapshot on the open transition, not on every selection change
    // while it's open — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function toggle(id: Id) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  const selectedText =
    value.length === 1
      ? options.find((o) => o.id === value[0])?.label ?? allLabel
      : t("filter.n_selected", "{n} נבחרו").replace("{n}", String(value.length));
  const summary =
    value.length === 0 ? allLabel : label ? `${label}: ${selectedText}` : selectedText;

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md border px-3 py-2 text-sm ${
          value.length > 0
            ? "border-primary text-primary bg-primary/5"
            : "border-input text-foreground hover:bg-accent"
        }`}
      >
        {summary} <span className="text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 min-w-[12rem] max-h-64 overflow-y-auto rounded-xl border border-border bg-card shadow-lg p-2 space-y-1 text-sm">
          {searchable && (
            <input
              className="w-full rounded-md border border-input px-2 py-1.5 focus:border-primary focus:outline-none"
              placeholder={t("select.search_ph", "הקלד לחיפוש…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {options.length === 0 ? (
            <p className="px-2 py-1 text-muted-foreground">—</p>
          ) : visible.length === 0 ? (
            <p className="px-2 py-1 text-muted-foreground">
              {t("select.no_matches", "אין תוצאות")}
            </p>
          ) : (
            visible.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 rounded px-2 py-1 cursor-pointer hover:bg-accent"
              >
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={value.includes(o.id)}
                  onChange={() => toggle(o.id)}
                />
                {o.label}
              </label>
            ))
          )}
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-start rounded px-2 py-1 text-primary hover:bg-primary/5"
            >
              {t("filter.clear", "נקה סינון")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
