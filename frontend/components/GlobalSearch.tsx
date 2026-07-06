"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { globalSearch, type SearchHit, type SearchHitType } from "@/lib/api";
import { useLocalization } from "@/lib/localization";

const DETAIL_PATH: Record<SearchHitType, string> = {
  contact: "/dashboard/contacts",
  area: "/dashboard/areas",
  building: "/dashboard/buildings",
  apartment: "/dashboard/apartments",
};

const GROUP_ORDER: SearchHitType[] = ["contact", "area", "building", "apartment"];

const TYPE_ICON: Record<SearchHitType, string> = {
  contact: "👤",
  area: "🗺️",
  building: "🏢",
  apartment: "🚪",
};

/**
 * Header search box that finds anything in the org: areas, buildings,
 * apartments, and contacts (mekurav/shliach). Debounced query against
 * GET /api/search; results grouped by type, each row linking to its detail
 * page. Same open/close behavior as NavMenu (outside click, Esc, navigation).
 */
export function GlobalSearch() {
  const { t } = useLocalization();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const groupLabel: Record<SearchHitType, string> = {
    contact: t("search.group.contacts", "אנשי קשר"),
    area: t("search.group.areas", "אזורים"),
    building: t("search.group.buildings", "בניינים"),
    apartment: t("search.group.apartments", "דירות"),
  };

  // Debounced fetch; ignores stale responses via the closure check.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      globalSearch(term)
        .then((data) => {
          if (cancelled) return;
          setHits(data.results);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Close on outside click or Escape; clear on navigation.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [pathname]);

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div ref={ref} className="relative w-full max-w-xs">
      <span className="pointer-events-none absolute inset-y-0 start-2.5 flex items-center text-gray-400">
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t("search.placeholder", "חיפוש כללי: אזור, בניין, דירה, איש קשר…")}
        className="w-full rounded-md border border-gray-300 bg-gray-50 py-1.5 ps-8 pe-3 text-sm focus:border-status-magenta focus:bg-white focus:outline-none"
      />

      {showDropdown && (
        <div className="absolute top-full start-0 z-50 mt-1 max-h-96 w-full min-w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg shadow-gray-900/5">
          {loading && (
            <div className="px-3 py-2 text-sm text-gray-500">
              {t("search.searching", "מחפש…")}
            </div>
          )}
          {!loading && hits.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">
              {t("search.no_results", "לא נמצאו תוצאות")}
            </div>
          )}
          {!loading &&
            GROUP_ORDER.map((type) => {
              const group = hits.filter((h) => h.type === type);
              if (group.length === 0) return null;
              return (
                <div key={type}>
                  <div className="px-3 pt-2 pb-1 text-xs font-medium text-gray-400">
                    {groupLabel[type]}
                  </div>
                  {group.map((h) => (
                    <Link
                      key={`${h.type}-${h.id}`}
                      href={`${DETAIL_PATH[h.type]}/${h.id}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
                    >
                      <span aria-hidden="true">{TYPE_ICON[h.type]}</span>
                      <span className="truncate font-medium">{h.title}</span>
                      {h.type === "contact" && h.contact_type && (
                        <span className="shrink-0 rounded bg-status-magenta/10 px-1.5 py-0.5 text-xs text-status-magenta">
                          {h.contact_type === "shliach"
                            ? t("contact_shliach", "פעיל")
                            : t("contact_mekurav", "מקורב")}
                        </span>
                      )}
                      {h.subtitle && (
                        <span className="ms-auto shrink-0 text-xs text-gray-400">
                          {h.subtitle}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
