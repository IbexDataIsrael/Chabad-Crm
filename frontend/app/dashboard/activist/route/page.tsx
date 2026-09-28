"use client";

import { useRouter } from "next/navigation";
import { LayoutGrid, RectangleVertical, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Celebration, type CelebrationKind } from "@/components/Celebration";
import { DividerCard } from "@/components/activist/DividerCard";
import { DoorCard, formatClockTime } from "@/components/activist/DoorCard";
import { OutcomeButtons } from "@/components/activist/OutcomeButtons";
import { RouteGrid } from "@/components/activist/RouteGrid";
import { RouteProgress } from "@/components/activist/RouteProgress";
import { Button } from "@/components/ui/button";
import { useActivistRoute } from "@/lib/activistRoute";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useLocalization } from "@/lib/localization";
import { enqueueOutcome, startOutboxSync, undoOutcome, useOutbox } from "@/lib/outbox";
import { usePersistentState } from "@/lib/persist";
import { FIXED_APARTMENT_PICKLIST_KEYS, usePicklistsMap } from "@/lib/picklists";
import {
  buildingDisplayName,
  type ApartmentRouteItem,
  type DoorOutcome,
  type PicklistField,
} from "@/lib/types";

// fixes68 §6.3: fire a star burst the first time each threshold is crossed.
const MILESTONES = [25, 50, 75];

interface RoutePosition {
  apartmentId: number | null;
  index: number;
}

interface UndoState {
  clientUuid: string;
  apartmentId: number;
  previousOutcome: DoorOutcome | null;
  previousAt: string | null;
}

function crossesBoundary(a: ApartmentRouteItem, b: ApartmentRouteItem): boolean {
  return a.building_id !== b.building_id || (a.floor ?? "") !== (b.floor ?? "");
}

// fixes68 §7.1: deterministic RebbeInspiration index — how many building/
// floor boundaries have been crossed to reach `index`.
function countDividersBefore(items: ApartmentRouteItem[], index: number): number {
  let count = 0;
  for (let i = 1; i <= index && i < items.length; i++) {
    if (crossesBoundary(items[i], items[i - 1])) count++;
  }
  return count;
}

// fixes68 §4.3: how many doors share the upcoming door's building+floor —
// the divider's "{n} doors left" is scoped to that group, not the whole route.
function upcomingGroupSize(items: ApartmentRouteItem[], index: number): number {
  const ref = items[index];
  let n = 0;
  for (
    let i = index;
    i < items.length && items[i].building_id === ref.building_id && (items[i].floor ?? "") === (ref.floor ?? "");
    i++
  ) {
    n++;
  }
  return n;
}

export default function ActivistRoutePage() {
  const router = useRouter();
  const { isShliach, loading: authLoading } = useAuth();
  const { t } = useLocalization();
  const route = useActivistRoute();
  const outbox = useOutbox();

  // fixes68: every apartment field must show, including any admin-added
  // apartment.* picklist or custom field — fetched once (org-wide, not
  // per-door) and looked up by DoorCard.
  const customFieldDefs = useCustomFieldDefs("apartment");
  const [picklistFields, setPicklistFields] = useState<PicklistField[]>([]);
  useEffect(() => {
    apiFetch<PicklistField[]>("/api/picklists")
      .then(setPicklistFields)
      .catch(() => setPicklistFields([]));
  }, []);
  const dynamicPicklistFields = useMemo(
    () =>
      picklistFields
        .filter((f) => f.entity_type === "apartment" && !FIXED_APARTMENT_PICKLIST_KEYS.includes(f.field_key))
        .map((f) => ({ field_key: f.field_key, label: f.label, english_label: f.english_label })),
    [picklistFields],
  );
  const { labelFor: picklistLabelFor } = usePicklistsMap([
    ...FIXED_APARTMENT_PICKLIST_KEYS,
    ...dynamicPicklistFields.map((f) => f.field_key),
  ]);

  const [view, setView] = usePersistentState<"cards" | "grid">("crm.activist.view", "cards");
  const [position, setPosition] = usePersistentState<RoutePosition>(
    "crm.activist.routePos.v1",
    { apartmentId: null, index: 0 },
  );
  const [showDivider, setShowDivider] = useState(false);
  const [celebration, setCelebration] = useState<CelebrationKind | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const firedMilestones = useRef(new Set<number>());
  const positionResolved = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isShliach) router.replace("/dashboard");
  }, [authLoading, isShliach, router]);

  // fixes68 §8.1: wire the outbox's flush triggers for the lifetime of the page.
  useEffect(() => startOutboxSync(), []);

  useEffect(() => {
    if (!undoState) return;
    const timer = window.setTimeout(() => setUndoState(null), 5000);
    return () => window.clearTimeout(timer);
  }, [undoState]);

  // fixes68 §4.2: resolve a stale persisted position (the set may have
  // changed since last visit) by apartment id first, falling back to a
  // clamped index — once, as soon as live/cached route data is available.
  useEffect(() => {
    if (route.items.length === 0 || positionResolved.current) return;
    positionResolved.current = true;
    const byId =
      position.apartmentId != null
        ? route.items.findIndex((i) => i.id === position.apartmentId)
        : -1;
    const resolved = byId >= 0 ? byId : Math.min(Math.max(position.index, 0), route.items.length - 1);
    if (route.items[resolved]?.id !== position.apartmentId) {
      setPosition({ apartmentId: route.items[resolved]?.id ?? null, index: resolved });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.items.length]);

  const total = route.items.length;
  const doneCount = useMemo(
    () => route.items.filter((i) => i.last_outcome != null).length,
    [route.items],
  );
  const routeComplete = total > 0 && doneCount === total;
  const index = Math.min(Math.max(position.index, 0), Math.max(total - 1, 0));
  const currentItem = total > 0 ? route.items[index] : null;
  const dividerIndex = countDividersBefore(route.items, index);

  function goTo(nextIndex: number, opts: { divider: boolean }) {
    const item = route.items[nextIndex];
    setPosition({ apartmentId: item?.id ?? null, index: nextIndex });
    setShowDivider(opts.divider);
  }

  function handleMark(outcome: DoorOutcome) {
    if (!currentItem) return;
    const clientUuid =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    const now = new Date().toISOString();
    const previousOutcome = currentItem.last_outcome;
    const previousAt = currentItem.last_outcome_at;

    enqueueOutcome({ client_uuid: clientUuid, apartment_id: currentItem.id, outcome, at: now });
    route.applyLocalOutcome(currentItem.id, outcome, now);
    setUndoState({
      clientUuid,
      apartmentId: currentItem.id,
      previousOutcome,
      previousAt,
    });

    const newDoneCount = previousOutcome == null ? doneCount + 1 : doneCount;
    if (total > 0 && newDoneCount === total) {
      setCelebration("complete");
      return; // nothing left to advance to
    }
    for (const m of MILESTONES) {
      if (!firedMilestones.current.has(m) && (newDoneCount / total) * 100 >= m) {
        firedMilestones.current.add(m);
        setCelebration("milestone");
        break;
      }
    }

    const nextIndex = index + 1;
    if (nextIndex < total) {
      goTo(nextIndex, { divider: crossesBoundary(route.items[nextIndex], currentItem) });
    }
  }

  function handleUndo() {
    if (!undoState) return;
    if (undoOutcome(undoState.clientUuid)) {
      route.applyLocalOutcome(undoState.apartmentId, undoState.previousOutcome, undoState.previousAt);
    }
    setUndoState(null);
  }

  function handleBack() {
    if (index === 0) return;
    goTo(index - 1, { divider: false });
  }

  function handleSelectFromGrid(selectedIndex: number) {
    goTo(selectedIndex, { divider: false });
    setView("cards");
  }

  if (authLoading || !isShliach) {
    return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {route.offline
            ? t("activist_route.offline", "לא מקוון - מציג נתונים מ-{time}").replace(
                "{time}",
                route.fetchedAt ? formatClockTime(route.fetchedAt) : "",
              )
            : route.fetchedAt
              ? t("activist_route.synced", "עודכן {time}").replace(
                  "{time}",
                  formatClockTime(route.fetchedAt),
                )
              : ""}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={route.refresh}
            aria-label={t("activist_route.refresh", "רענון")}
            className="rounded-md p-1.5 hover:bg-accent"
          >
            <RefreshCw className={`h-4 w-4 ${route.refreshing ? "animate-spin" : ""}`} />
          </button>
          <Button
            type="button"
            variant={view === "cards" ? "secondary" : "ghost"}
            size="icon"
            aria-label={t("activist_route.view_cards", "תצוגת כרטיסים")}
            onClick={() => setView("cards")}
          >
            <RectangleVertical className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon"
            aria-label={t("activist_route.view_grid", "תצוגת רשימה")}
            onClick={() => setView("grid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {outbox.pending > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {outbox.flushing && <RefreshCw className="h-3 w-3 animate-spin" />}
          <span>
            {t("activist_route.outbox_pending", "{n} סימונים ממתינים לסנכרון").replace(
              "{n}",
              String(outbox.pending),
            )}
          </span>
          {outbox.hasFailed && <span className="text-status-darkred">⚠</span>}
        </div>
      )}

      {total > 0 && <RouteProgress done={doneCount} total={total} />}

      {route.loading ? (
        <p className="p-6 text-center text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : total === 0 ? (
        route.offline ? (
          <div className="space-y-2 p-6 text-center">
            <p className="text-muted-foreground">
              {t("activist_route.load_failed", "טעינת הסיבוב נכשלה")}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={route.refresh}>
              {t("action.retry", "נסה שוב")}
            </Button>
          </div>
        ) : (
          <p className="p-6 text-center text-muted-foreground">
            {t("activist_route.no_doors", "אין דלתות בסיבוב שלך")}
          </p>
        )
      ) : view === "grid" ? (
        <RouteGrid items={route.items} onSelect={handleSelectFromGrid} />
      ) : routeComplete ? (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-2xl font-bold">
            {t("activist_route.complete", "סיימת את כל הדלתות - כל הכבוד!")}
          </div>
        </div>
      ) : showDivider && currentItem ? (
        <div className="min-h-[50vh]">
          <DividerCard
            buildingAddress={buildingDisplayName(currentItem)}
            floor={currentItem.floor ?? ""}
            remaining={upcomingGroupSize(route.items, index)}
            inspirationIndex={dividerIndex}
            onContinue={() => setShowDivider(false)}
          />
        </div>
      ) : currentItem ? (
        <div className="flex flex-col gap-2">
          {index > 0 && (
            <button
              type="button"
              onClick={handleBack}
              className="self-start text-sm text-muted-foreground hover:text-foreground"
            >
              {t("activist_route.back", "חזרה")}
            </button>
          )}
          <div className="min-h-[45vh]">
            <DoorCard
              item={currentItem}
              picklistLabelFor={picklistLabelFor}
              dynamicPicklistFields={dynamicPicklistFields}
              customFieldDefs={customFieldDefs}
            />
          </div>
          <OutcomeButtons onMark={handleMark} />
        </div>
      ) : null}

      {undoState && (
        <div className="fixed inset-x-4 bottom-24 z-20 flex items-center justify-between gap-3 rounded-lg bg-foreground px-4 py-3 text-background shadow-lg">
          <span className="text-sm">{t("activist_route.undo", "בטל - עוד לא סונכרן")}</span>
          <button
            type="button"
            onClick={handleUndo}
            className="shrink-0 text-sm font-bold underline underline-offset-2"
          >
            {t("activist_route.undo_action", "בטל")}
          </button>
        </div>
      )}

      <Celebration fire={celebration} onDone={() => setCelebration(null)} />
    </div>
  );
}
