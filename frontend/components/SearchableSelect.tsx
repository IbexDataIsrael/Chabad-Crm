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
}: {
  value: Id | null;
  onChange: (id: Id | null) => void;
  options: { id: Id; label: string }[];
  /** Text shown while nothing is selected (e.g. "בחר בניין…"). */
  placeholder: string;
  /** Label of the clear row inside the list; defaults to the placeholder. */
  emptyLabel?: string;
  /** When false, the clear row is hidden (a selection is mandatory). */
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

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

  function pick(id: Id | null) {
    onChange(id);
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
      if (filtered[active]) pick(filtered[active].id);
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
        className={`w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-start focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta disabled:bg-gray-50 disabled:text-gray-400 ${
          selected ? "text-gray-900" : "text-gray-500"
        }`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <span className="text-xs text-gray-400">▾</span>
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[12rem] rounded-md border border-gray-200 bg-white shadow-lg text-sm">
          <div className="p-2 border-b border-gray-100">
            <input
              ref={searchRef}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 focus:border-status-magenta focus:outline-none"
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
                  className="w-full text-start rounded px-2 py-1.5 text-gray-500 hover:bg-gray-50"
                >
                  {emptyLabel ?? placeholder}
                </button>
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-2 py-1.5 text-gray-400">
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
                    onClick={() => pick(o.id)}
                    className={`w-full text-start rounded px-2 py-1.5 ${
                      o.id === value
                        ? "bg-status-magenta/10 text-status-magenta font-medium"
                        : i === active
                          ? "bg-gray-100 text-gray-800"
                          : "text-gray-700 hover:bg-gray-50"
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
