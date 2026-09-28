"use client";

// fixes68 §1: one upfront, activist-scoped, cached load of the whole route —
// zero per-apartment round trips. Cached items render synchronously on open
// (even offline); a background fetch then replaces cache + state.
import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "./api";
import type { ApartmentRouteItem, DoorOutcome } from "./types";

const CACHE_KEY = "crm.activist.routeCache.v1";

interface RouteCache {
  fetchedAt: string;
  items: ApartmentRouteItem[];
}

function readCache(): RouteCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as RouteCache) : null;
  } catch {
    return null;
  }
}

function writeCache(cache: RouteCache): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable (privacy mode) — state still updates in-memory */
  }
}

/** fixes68 §1: today's done/total for the activist landing-page tile, read
 *  straight from the cache — no network call from that page. */
export function routeCacheSummary(): { done: number; total: number } | null {
  const cache = readCache();
  if (!cache) return null;
  return {
    done: cache.items.filter((i) => i.last_outcome != null).length,
    total: cache.items.length,
  };
}

interface UseActivistRoute {
  items: ApartmentRouteItem[];
  fetchedAt: string | null;
  loading: boolean;
  refreshing: boolean;
  offline: boolean;
  refresh: () => void;
  /** fixes68 §3/§3.2: optimistic local patch right after a door mark (or its
   *  undo, passing back null/null) — updates both in-memory state and the
   *  cache, so a reload (or the grid/progress bar) reflects it immediately
   *  without waiting on the next server sync. */
  applyLocalOutcome: (
    apartmentId: number,
    outcome: DoorOutcome | null,
    at: string | null,
  ) => void;
}

export function useActivistRoute(): UseActivistRoute {
  const initial = readCache();
  const [items, setItems] = useState<ApartmentRouteItem[]>(initial?.items ?? []);
  const [fetchedAt, setFetchedAt] = useState<string | null>(initial?.fetchedAt ?? null);
  const [loading, setLoading] = useState(initial == null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    apiFetch<ApartmentRouteItem[]>("/api/apartments/my-route")
      .then((data) => {
        const now = new Date().toISOString();
        setItems(data);
        setFetchedAt(now);
        setOffline(false);
        writeCache({ fetchedAt: now, items: data });
      })
      .catch(() => {
        setOffline(true);
      })
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyLocalOutcome = useCallback(
    (apartmentId: number, outcome: DoorOutcome | null, at: string | null) => {
      setItems((prev) => {
        const next = prev.map((i) =>
          i.id === apartmentId ? { ...i, last_outcome: outcome, last_outcome_at: at } : i,
        );
        const cache = readCache();
        writeCache({ fetchedAt: cache?.fetchedAt ?? new Date().toISOString(), items: next });
        return next;
      });
    },
    [],
  );

  return { items, fetchedAt, loading, refreshing, offline, refresh: load, applyLocalOutcome };
}
