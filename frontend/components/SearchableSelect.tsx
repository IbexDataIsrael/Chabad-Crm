"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useLocalization } from "@/lib/localization";

/**
 * fixes18 §general: single-select combobox for DB-backed entity lists
 * (apartments / buildings / shliach / mekurav contacts) — replaces the native
 * `<select>` so users can type and filter the options inline.
 *
 * Closed it renders as an input-styled button showing the current selection;
 * open it shows a search box (auto-focused) above the filtered list. `null`
 * means "nothing selected" — the placeholder row re-selects it (unless
 * `allowEmpty` is false). Basic keyboard support: ↑/↓ move, Enter picks,
 * Escape closes.
 *
 * fixes54 §2: an optional `remoteSearch` swaps the local `options` filter for
 * a debounced server-side query — for a list too large to load and filter
 * client-side (e.g. buildings, which grew past 8,000 rows in production and
 * made ApartmentPicker's old "load every building, filter in the browser"
 * approach flash "no buildings yet" while the multi-MB payload was still in
 * flight, then render a several-thousand-row dropdown too sluggish to use).
 * `selectedLabel` covers the closed-button display in that mode, since the
 * selected id may not be present in the current (small) result page.
 */
export function SearchableSelect<Id extends number | string>({
  value,
  onChange,
  options,
  placeholder,
  emptyLabel,
  allowEmpty = true,
  disabled = false,
  className = "",
  remoteSearch,
  selectedLabel,
}: {
  value: Id | null;
  /** `label` is the picked option's label (undefined for the clear row) —
   *  lets a `remoteSearch` consumer keep the closed-button text without a
   *  separate lookup (see `selectedLabel`). */
  onChange: (id: Id | null, label?: string | null) => void;
  options: { id: Id; label: string }[];
  /** Text shown while nothing is selected (e.g. "בחר בניין…"). */
  placeholder: string;
  /** Label of the clear row inside the list; defaults to the placeholder. */
  emptyLabel?: string;
  /** When false, the clear row is hidden (a selection is mandatory). */
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  /** When set, `options` is ignored — the list is fetched server-side per
   *  query string (debounced), instead of filtered client-side. */
  remoteSearch?: (query: string) => Promise<{ id: Id; label: string }[]>;
  /** Closed-button label for the current `value` in remote mode (the id may
   *  not be present in the latest fetched page). Falls back to `value`. */
  selectedLabel?: string | null;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [remoteOptions, setRemoteOptions] = useState<{ id: Id; label: string }[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = remoteSearch
    ? (value != null ? { id: value, label: selectedLabel ?? String(value) } : null)
    : options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    if (remoteSearch) return remoteOptions;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, remoteSearch, remoteOptions]);

  // fixes54 §2: debounced server-side fetch, re-run whenever the dropdown is
  // open and the query changes (including the initial empty query, so the
  // list isn't blank until the user types).
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

  // Keep the keyboard cursor on a real row as the filter narrows the list.
  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered.length, active]);

  function pick(id: Id | null, label?: string | null) {
    onChange(id, label);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) pick(filtered[active].id, filtered[active].label);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`w-full rounded-md border border-input px-3 py-2 text-sm text-start focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-background disabled:text-muted-foreground ${
          selected ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <span className="text-xs text-muted-foreground">▾</span>
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[12rem] rounded-xl border border-border bg-card shadow-lg text-sm">
          <div className="p-2 border-b border-border">
            <input
              ref={searchRef}
              className="w-full rounded-md border border-input px-2 py-1.5 focus:border-primary focus:outline-none"
              placeholder={t("select.search_ph", "הקלד לחיפוש…")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto p-1">
            {allowEmpty && (
              <li>
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className="w-full text-start rounded px-2 py-1.5 text-muted-foreground hover:bg-accent"
                >
                  {emptyLabel ?? placeholder}
                </button>
              </li>
            )}
            {remoteSearch && remoteLoading ? (
              <li className="px-2 py-1.5 text-muted-foreground">
                {t("action.loading", "טוען…")}
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-2 py-1.5 text-muted-foreground">
                {t("select.no_matches", "אין תוצאות")}
              </li>
            ) : (
              filtered.map((o, i) => (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.id === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o.id, o.label)}
                    className={`w-full text-start rounded px-2 py-1.5 ${
                      o.id === value
                        ? "bg-primary/10 text-primary font-medium"
                        : i === active
                          ? "bg-muted text-foreground"
                          : "text-foreground hover:bg-accent"
                    }`}
                  >
                    {o.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
