"use client";

import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { OrgDetails } from "@/lib/types";

export default function SettingsPage() {
  const { isAdmin, loading, refresh } = useAuth();
  const [name, setName] = useState("");
  const [mapInEnglish, setMapInEnglish] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<OrgDetails>("/api/organizations/me")
      .then((o) => {
        setName(o.name);
        setMapInEnglish(o.map_in_english);
      })
      .catch(() => {});
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiFetch<OrgDetails>("/api/organizations/me", {
        method: "PUT",
        body: JSON.stringify({ name, map_in_english: mapInEnglish }),
      });
      await refresh(); // update header/title
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-gray-400">טוען…</p>;
  if (!isAdmin) {
    return <p className="text-status-darkred">אין לך הרשאה לעמוד זה (מנהלים בלבד).</p>;
  }

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  return (
    <div className="space-y-5 max-w-lg">
      <h1 className="text-2xl font-bold">הגדרות ארגון</h1>

      <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">שם הארגון</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mapInEnglish}
            onChange={(e) => setMapInEnglish(e.target.checked)}
          />
          השלמת כתובות במפה באנגלית
        </label>
        <p className="text-xs text-gray-400">
          כאשר מסומן, הצעות הכתובת מ-Google יוחזרו באנגלית במקום בעברית.
        </p>

        {error && <p className="text-sm text-status-darkred">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-status-magenta text-white px-5 py-2 font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "שומר…" : "שמור"}
          </button>
          {saved && <span className="text-sm text-status-green">נשמר ✓</span>}
        </div>
      </form>
    </div>
  );
}
