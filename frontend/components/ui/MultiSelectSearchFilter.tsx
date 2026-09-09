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
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? options.filter((o) => o.label.toLowerCase().includes(needle))
      : options;
    // fixes60 §4: checked items float to the top — otherwise a selection in
    // a long, searchable list scrolls out of view the moment it reopens.
    return [...filtered].sort((a, b) => {
      const aSelected = value.includes(a.id);
      const bSelected = value.includes(b.id);
      if (aSelected === bSelected) return 0;
      return aSelected ? -1 : 1;
    });
  }, [options, query, value]);

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
    visible.forEach((o) => merged.add(o.id));
    onChange([...merged]);
  }

  const selectedLabel = useMemo(() => {
    if (value.length === 0) return allLabel;
    const selectedText =
      value.length === 1
        ? options.find((o) => o.id === value[0])?.label ?? allLabel
        : t("filter.n_selected", "{n} נבחרו").replace("{n}", String(value.length));
    return label ? `${label}: ${selectedText}` : selectedText;
  }, [value, options, allLabel, label, t]);

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`w-full rounded-md border px-3 py-2 text-sm text-start ${
          value.length > 0
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
          {/* Bulk affordances for high-volume lists. */}
          <div className="flex items-center justify-between px-1 pt-2 pb-1 text-xs text-muted-foreground">
            <span>
              {t("filter.n_of_total", "{n}/{total}")
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
            {options.length === 0 ? (
              <li className="px-2 py-1 text-muted-foreground">{emptyLabel}</li>
            ) : visible.length === 0 ? (
              <li className="px-2 py-1 text-muted-foreground">
                {t("select.no_matches", "אין תוצאות")}
              </li>
            ) : (
              visible.map((o) => {
                const checked = value.includes(o.id);
                return (
                  <li key={String(o.id)} role="option" aria-selected={checked}>
                    <label className="flex items-center gap-2 rounded px-2 py-1 cursor-pointer hover:bg-accent">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={checked}
                        onChange={() => toggle(o.id)}
                      />
                      <span className="truncate">{o.label}</span>
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
