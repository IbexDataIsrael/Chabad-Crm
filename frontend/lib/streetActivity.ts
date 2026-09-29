import { apiFetch } from "@/lib/api";

/** fixes74 §12: the activist's street2 work log. Events are queued on the
 *  device (localStorage, per user) and uploaded to /api/street-activity/sync
 *  — right away when online, and retried on the next event / heartbeat when
 *  not. Each event carries a client id so a retried upload can't duplicate
 *  it, and the device time it happened. The upload (or an empty heartbeat)
 *  is what moves the "last sync" time the admin sees. */

export type StreetEventType = "mark" | "unmark" | "building_complete";

export interface StreetEvent {
  client_id: string;
  event_type: StreetEventType;
  apartment_id: number | null;
  building_id: number | null;
  label: string | null;
  occurred_at: string;
}

const keyFor = (userId: number) => `crm.street2.pendingEvents.${userId}`;

function readQueue(userId: number): StreetEvent[] {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StreetEvent[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(userId: number, events: StreetEvent[]): void {
  try {
    if (events.length === 0) window.localStorage.removeItem(keyFor(userId));
    else window.localStorage.setItem(keyFor(userId), JSON.stringify(events.slice(-1000)));
  } catch {
    /* storage unavailable — the event is only sent if this upload succeeds */
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
}

let inFlight: Promise<void> | null = null;

/** Upload whatever is queued (an empty upload = heartbeat). Never throws. */
export function syncStreetActivity(userId: number): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const batch = readQueue(userId).slice(0, 500);
    try {
      await apiFetch("/api/street-activity/sync", {
        method: "POST",
        body: JSON.stringify({ events: batch }),
      });
      const sent = new Set(batch.map((e) => e.client_id));
      writeQueue(userId, readQueue(userId).filter((e) => !sent.has(e.client_id)));
    } catch {
      /* offline / server down — stays queued for the next sync */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function recordStreetEvent(
  userId: number,
  event: Omit<StreetEvent, "client_id" | "occurred_at">,
): void {
  const full: StreetEvent = { ...event, client_id: newId(), occurred_at: new Date().toISOString() };
  writeQueue(userId, [...readQueue(userId), full]);
  void syncStreetActivity(userId);
}
