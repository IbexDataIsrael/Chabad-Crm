"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A dependency-free Hebrew/RTL calendar date picker. Replaces native
 * date/datetime inputs across the app. Value is an ISO-ish string:
 *   - withTime=false → "YYYY-MM-DD"
 *   - withTime=true  → "YYYY-MM-DDTHH:mm"
 */
const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];
const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parse(value: string | null): { date: Date | null; time: string } {
  if (!value) return { date: null, time: "" };
  const [d, t] = value.split("T");
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return { date: null, time: t?.slice(0, 5) ?? "" };
  return { date: new Date(y, m - 1, day), time: t?.slice(0, 5) ?? "" };
}

export function DatePicker({
  value,
  onChange,
  withTime = false,
  className,
  placeholder = "בחר תאריך",
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  withTime?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const { date: selected, time } = parse(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => selected ?? new Date());
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function emit(d: Date, t: string) {
    const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (withTime) onChange(`${base}T${t || "09:00"}`);
    else onChange(base);
  }

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const display = selected
    ? `${pad(selected.getDate())}/${pad(selected.getMonth() + 1)}/${selected.getFullYear()}${
        withTime && time ? ` ${time}` : ""
      }`
    : "";

  return (
    <div className="relative" ref={wrapRef}>
      <input
        readOnly
        className={className}
        value={display}
        placeholder={placeholder}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              className="px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setView(new Date(year, month - 1, 1))}
            >
              ›
            </button>
            <span className="text-sm font-medium">
              {MONTHS[month]} {year}
            </span>
            <button
              type="button"
              className="px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setView(new Date(year, month + 1, 1))}
            >
              ‹
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-1">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <span key={i} />;
              const isSel =
                selected &&
                selected.getFullYear() === year &&
                selected.getMonth() === month &&
                selected.getDate() === day;
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => {
                    emit(new Date(year, month, day), time);
                    if (!withTime) setOpen(false);
                  }}
                  className={`h-8 rounded text-sm hover:bg-status-magenta/10 ${
                    isSel ? "bg-status-magenta text-white hover:bg-status-magenta" : ""
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          {withTime && (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="time"
                dir="ltr"
                className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                value={time || "09:00"}
                onChange={(e) => selected && emit(selected, e.target.value)}
              />
            </div>
          )}
          <div className="mt-3 flex justify-between">
            <button
              type="button"
              className="text-xs text-gray-500 hover:underline"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              נקה
            </button>
            <button
              type="button"
              className="text-xs text-status-magenta hover:underline"
              onClick={() => setOpen(false)}
            >
              סגור
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
