"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useLocalization } from "@/lib/localization";

/**
 * MultiSelectSearchFilter (fixes23 §1) — a reusable filter that combines a
 * multi-select checkbox list with an always-present text search box, so it
 * stays usable when the option list runs to hundreds of records (report
 * numbers, buildings). A compact trigger button shows the selection summary and
 * opens a scrollable, keyboard-accessible panel. An empty selection means
 * "all" (no filtering). Ids may be numbers or strings.
 *
 * Distinct from the older `MultiSelectFilter`: the search box is unconditional
 * (not gated on list length), the panel carries proper listbox semantics, and
 * "select all (filtered) / clear" affordances make bulk selection practical for
 * high-volume lists.
 *
 * fixes61 §3: an optional `remoteSearch` (same shape/convention as
 * `SearchableSelect`'s) swaps the local `options` filter for a debounced
 * server-side query, for a list too large to load and filter client-side in
 * one shot (e.g. buildings) — the caller passes a small default/initial
 * `options` page (e.g. the first 100) and a `remoteSearch` that re-fetches as
 * the user types.
 */
export function MultiSelectSearchFilter<Id extends number | string>({
  allLabel,
  label,
  options,
  value,
  onChange,
  searchPlaceholder,
  emptyLabel = "—",
  className = "",
  buttonClassName = "",
  remoteSearch,
  lockedIds,
  lockedHint,
}: {
  /** Trigger text while nothing is selected, e.g. "כל הבניינים". */
  allLabel: string;
  /** fixes56 §3: short, persistent filter name (e.g. "בניין") kept visible as
   *  a prefix once something is checked, so the trigger doesn't collapse to
   *  just the selected value or a bare count once active. Omit to keep the
   *  old (pre-fixes56) behavior. */
  label?: string;
  options: { id: Id; label: string }[];
  value: Id[];
  onChange: (ids: Id[]) => void;
  /** Optional placeholder for the internal search box. */
  searchPlaceholder?: string;
  /** Rendered when there are no options at all. */
  emptyLabel?: string;
  className?: string;
  buttonClassName?: string;
  /** When set, the dropdown list is fetched server-side per query string
   *  (debounced) instead of filtering `options` client-side. `options` is
   *  still used as the initial/default page (before the user has typed) and
   *  as a label source for already-selected ids. */
  remoteSearch?: (query: string) => Promise<{ id: Id; label: string }[]>;
  /** fixes75 §2: options shown checked but not toggleable (e.g. report
   *  numbers another task already covers). Not part of `value`. */
  lockedIds?: Id[];
  /** Short note after a locked option's label, e.g. "(במשימה אחרת)". */
  lockedHint?: string;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteOptions, setRemoteOptions] = useState<{ id: Id; label: string }[]>(options);
  const [remoteLoading, setRemoteLoading] = useState(false);
  // fixes61 §3: a selected id can scroll out of the current (small, searched)
  // result page — this keeps every label ever seen so the trigger button and
  // checked rows never fall back to a bare id/allLabel once that happens.
  const [knownLabels, setKnownLabels] = useState<Map<Id, string>>(new Map());
  // fixes62 (follow-up): selected items float to the top, but only settle
  // there between dropdown sessions — the sort order is snapshotted the
  // moment the dropdown opens and held fixed while it stays open, so
  // checking an item mid-session doesn't yank it out from under the user's
  // scroll position. The next time they open it, the snapshot is refreshed
  // and anything they just checked floats up.
  const [frozenSelected, setFrozenSelected] = useState<Set<Id>>(new Set());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const filtered = useMemo(() => {
    if (remoteSearch) return remoteOptions;
    const needle = query.trim().toLowerCase();
    return needle
      ? options.filter((o) => o.label.toLowerCase().includes(needle))
      : options;
  }, [options, query, remoteSearch, remoteOptions]);

  const locked = useMemo(() => new Set<Id>(lockedIds ?? []), [lockedIds]);

  const visible = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        // fixes75 §2: locked (shown-as-selected) options float up too.
        const aFirst = frozenSelected.has(a.id) || locked.has(a.id) ? 0 : 1;
        const bFirst = frozenSelected.has(b.id) || locked.has(b.id) ? 0 : 1;
        return aFirst - bFirst;
      }),
    [filtered, frozenSelected, locked],
  );

  useEffect(() => {
    if (open) setFrozenSelected(new Set(value));
    // Only resnapshot on the open transition, not on every selection change
    // while it's open — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const src = remoteSearch ? remoteOptions : options;
    if (src.length === 0) return;
    setKnownLabels((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const o of src) {
        if (next.get(o.id) !== o.label) {
          next.set(o.id, o.label);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [options, remoteOptions, remoteSearch]);

  // fixes61 §3: debounced server-side fetch, re-run whenever the dropdown is
  // open and the query changes (including the initial empty query, so the
  // list reflects a live search rather than staying pinned to `options`).
  useEffect(() => {
    if (!remoteSearch || !open) return;
    let active = true;
    setRemoteLoading(true);
    const timer = setTimeout(() => {
      remoteSearch(query.trim())
        .then((rows) => {
          if (active) setRemoteOptions(rows);
        })
        .catch(() => {
          if (active) setRemoteOptions([]);
        })
        .finally(() => {
          if (active) setRemoteLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteSearch, open, query]);

  // Close on outside click; focus the search box when the panel opens.
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
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

  function selectAllVisible() {
    const merged = new Set<Id>(value);
    visible.forEach((o) => {
      if (!locked.has(o.id)) merged.add(o.id);
    });
    onChange([...merged]);
  }

  const selectedLabel = useMemo(() => {
    // fixes75 §2: locked options count as selected in the summary too.
    const shown = [...(lockedIds ?? []), ...value.filter((v) => !locked.has(v))];
    if (shown.length === 0) return allLabel;
    const selectedText =
      shown.length === 1
        ? (knownLabels.get(shown[0]) ?? options.find((o) => o.id === shown[0])?.label ?? allLabel)
        : t("filter.n_selected", "{n} נבחרו").replace("{n}", String(shown.length));
    return label ? `${label}: ${selectedText}` : selectedText;
  }, [value, lockedIds, locked, options, knownLabels, allLabel, label, t]);

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`w-full rounded-md border px-3 py-2 text-sm text-start ${
          value.length > 0 || locked.size > 0
            ? "border-primary text-primary bg-primary/5"
            : "border-input text-foreground hover:bg-accent"
        } ${buttonClassName}`}
      >
        <span className="truncate">{selectedLabel}</span>{" "}
        <span className="text-xs">▾</span>
      </button>
      {open && (
        <div
          className="absolute z-30 mt-1 min-w-[14rem] rounded-xl border border-border bg-card shadow-lg p-2 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <input
            ref={searchRef}
            type="text"
            aria-label={searchPlaceholder ?? t("select.search_ph", "הקלד לחיפוש…")}
            className="w-full rounded-md border border-input px-2 py-1.5 focus:border-primary focus:outline-none"
            placeholder={searchPlaceholder ?? t("select.search_ph", "הקלד לחיפוש…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* Bulk affordances for high-volume lists. fixes61 §3: in
              remoteSearch mode `options.length` is just the initial page
              size, not the org's real total — showing it would be
              misleading, so the counter is dropped in that mode. */}
          <div className="flex items-center justify-between px-1 pt-2 pb-1 text-xs text-muted-foreground">
            <span>
              {!remoteSearch &&
                t("filter.n_of_total", "{n}/{total}")
                  .replace("{n}", String(visible.length))
                  .replace("{total}", String(options.length))}
            </span>
            <div className="flex items-center gap-2">
              {visible.length > 0 && (
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="text-primary hover:underline"
                >
                  {t("filter.select_all_shown", "בחר את המוצגים")}
                </button>
              )}
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-primary hover:underline"
                >
                  {t("filter.clear", "נקה סינון")}
                </button>
              )}
            </div>
          </div>
          <ul
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={allLabel}
            className="max-h-64 overflow-y-auto space-y-0.5"
          >
            {remoteSearch && remoteLoading ? (
              <li className="px-2 py-1 text-muted-foreground">
                {t("action.loading", "טוען…")}
              </li>
            ) : options.length === 0 && visible.length === 0 ? (
              <li className="px-2 py-1 text-muted-foreground">{emptyLabel}</li>
            ) : visible.length === 0 ? (
              <li className="px-2 py-1 text-muted-foreground">
                {t("select.no_matches", "אין תוצאות")}
              </li>
            ) : (
              visible.map((o) => {
                const isLocked = locked.has(o.id);
                const checked = isLocked || value.includes(o.id);
                return (
                  <li
                    key={String(o.id)}
                    role="option"
                    aria-selected={checked}
                    aria-disabled={isLocked || undefined}
                  >
                    <label
                      className={`flex items-center gap-2 rounded px-2 py-1 ${
                        isLocked ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer hover:bg-accent"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={checked}
                        disabled={isLocked}
                        onChange={() => toggle(o.id)}
                      />
                      <span className="truncate">{o.label}</span>
                      {isLocked && lockedHint && (
                        <span className="ms-auto shrink-0 text-xs">{lockedHint}</span>
                      )}
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
