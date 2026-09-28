"use client";

// fixes68 §8: the stairwell-tolerant offline queue — a door mark is appended
// here optimistically and flushed to the server in the background (on
// 'online', every 30s, and right after each append). The server dedupes on
// client_uuid (routers/apartments.py::record_door_outcome), so a retried
// POST after a dropped response can never double-log a visit.
import { useEffect, useState } from "react";

import { apiFetch, ApiError } from "./api";
import type { DoorOutcome, DoorOutcomeResult } from "./types";

const OUTBOX_KEY = "crm.activist.outbox.v1";
const FLUSH_INTERVAL_MS = 30_000;

export interface OutboxItem {
  client_uuid: string;
  apartment_id: number;
  outcome: DoorOutcome;
  at: string;
  notes?: string;
  /** A 4xx came back for this item — kept (never silently dropped) but not
   *  retried automatically; the badge surfaces it as a warning. */
  failed?: boolean;
}

interface OutboxState {
  items: OutboxItem[];
  flushing: boolean;
}

function readItems(): OutboxItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function writeItems(items: OutboxItem[]): void {
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable — marks stay optimistic-only this session */
  }
}

let state: OutboxState = { items: readItems(), flushing: false };
const listeners = new Set<(s: OutboxState) => void>();

function setState(patch: Partial<OutboxState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

/** fixes68 §8.1: queue a door mark, then kick an async flush. */
export function enqueueOutcome(item: Omit<OutboxItem, "failed">): void {
  const items = [...state.items, { ...item, failed: false }];
  writeItems(items);
  setState({ items });
  void flushOutbox();
}

/** fixes68 §3.2: undo — only while still unsynced. Returns false once the
 *  outbox has already dropped it (flushed, or it was never there). */
export function undoOutcome(clientUuid: string): boolean {
  if (!state.items.some((i) => i.client_uuid === clientUuid)) return false;
  const items = state.items.filter((i) => i.client_uuid !== clientUuid);
  writeItems(items);
  setState({ items });
  return true;
}

/** fixes68 §8.1: sequential flush — one POST at a time, so a retry can never
 *  race a still-in-flight request from the same client. A network error or
 *  5xx stops the flush for a later retry; a 4xx flags that one item (never
 *  silently dropped) and moves on to the rest of the queue. */
export async function flushOutbox(): Promise<void> {
  if (state.flushing) return;
  setState({ flushing: true });
  try {
    for (;;) {
      const next = state.items.find((i) => !i.failed);
      if (!next) break;
      try {
        await apiFetch<DoorOutcomeResult>(
          `/api/apartments/${next.apartment_id}/door-outcome`,
          {
            method: "POST",
            body: JSON.stringify({
              outcome: next.outcome,
              client_uuid: next.client_uuid,
              notes: next.notes,
            }),
          },
        );
        const items = state.items.filter((i) => i.client_uuid !== next.client_uuid);
        writeItems(items);
        setState({ items });
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          const items = state.items.map((i) =>
            i.client_uuid === next.client_uuid ? { ...i, failed: true } : i,
          );
          writeItems(items);
          setState({ items });
          continue;
        }
        break;
      }
    }
  } finally {
    setState({ flushing: false });
  }
}

/** fixes68 §8.1: wires the flush triggers (the 'online' event + a 30s
 *  interval) — call once from the route page; returns a cleanup function. */
export function startOutboxSync(): () => void {
  const onOnline = () => void flushOutbox();
  window.addEventListener("online", onOnline);
  const interval = window.setInterval(() => void flushOutbox(), FLUSH_INTERVAL_MS);
  void flushOutbox();
  return () => {
    window.removeEventListener("online", onOnline);
    window.clearInterval(interval);
  };
}

/** fixes68 §8.2: the outbox badge's live state. */
export function useOutbox(): { pending: number; flushing: boolean; hasFailed: boolean } {
  const [s, setS] = useState<OutboxState>(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return {
    pending: s.items.length,
    flushing: s.flushing,
    hasFailed: s.items.some((i) => i.failed),
  };
}
