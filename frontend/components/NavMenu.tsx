"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export interface NavMenuItem {
  href: string;
  label: string;
}

/**
 * Header dropdown menu styled after material-tailwind's "menu" component
 * (rounded card, soft shadow, hover-filled rows). RTL-aware, keyboard
 * accessible (Esc to close), closes on outside-click and on navigation.
 *
 * Renders nothing when it has no items (e.g. all entries were admin-gated
 * away for a staff user).
 */
export function NavMenu({ label, items }: { label: string; items: NavMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const menuId = useId();

  // Close on outside click or Escape.
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

  if (items.length === 0) return null;

  // fixes50 §3.3: a naive prefix match makes a sibling item's own href (e.g.
  // "/dashboard/contacts/visit-summary") also match a shorter item's prefix
  // rule (e.g. "/dashboard/contacts" + "/"), lighting up both at once. Only
  // the longest ("most specific") matching href in the menu counts as
  // active — this still lets a shorter href match its own detail routes
  // (e.g. "/dashboard/contacts/123") when nothing more specific exists.
  function matchLength(href: string): number {
    if (pathname === href) return href.length;
    if (pathname.startsWith(href + "/")) return href.length;
    return -1;
  }
  const bestMatch = Math.max(-1, ...items.map((it) => matchLength(it.href)));
  const groupActive = bestMatch >= 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors hover:bg-gray-100 ${
          groupActive ? "text-status-magenta font-medium" : "text-gray-700"
        }`}
      >
        {label}
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <ul
          id={menuId}
          role="menu"
          className="absolute top-full start-0 z-50 mt-1 min-w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-lg shadow-gray-900/5 focus:outline-none"
        >
          {items.map((it) => {
            const active = bestMatch >= 0 && matchLength(it.href) === bestMatch;
            return (
              <li key={it.href} role="none">
                <Link
                  href={it.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={`block rounded-md px-3 py-2 text-sm transition-colors hover:bg-gray-100 ${
                    active ? "bg-status-magenta/10 text-status-magenta font-medium" : "text-gray-700"
                  }`}
                >
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
