"use client";

import { useMemo } from "react";

import { useLocalization } from "@/lib/localization";
import { apartmentTitle, buildingDisplayName, type ApartmentRouteItem } from "@/lib/types";
import { OUTCOME_KEY } from "./DoorCard";

interface RouteGridProps {
  items: ApartmentRouteItem[];
  /** Route-order index (matches the card view's position) of the tapped door. */
  onSelect: (index: number) => void;
}

interface FloorGroup {
  floor: string;
  rows: { item: ApartmentRouteItem; index: number }[];
}
interface BuildingGroup {
  key: string;
  label: string;
  floors: FloorGroup[];
}

/** fixes68 §2.2: the grid fallback view — building -> floor -> compact rows
 *  with a status chip; tapping a row hands back the door's index in the
 *  server's hierarchy order so the parent can jump card mode there. */
export function RouteGrid({ items, onSelect }: RouteGridProps) {
  const { t } = useLocalization();

  const groups = useMemo<BuildingGroup[]>(() => {
    const byBuilding = new Map<string, BuildingGroup>();
    items.forEach((item, index) => {
      const bKey = String(item.building_id);
      let building = byBuilding.get(bKey);
      if (!building) {
        building = { key: bKey, label: buildingDisplayName(item), floors: [] };
        byBuilding.set(bKey, building);
      }
      const floorLabel = item.floor || "";
      let floorGroup = building.floors.find((f) => f.floor === floorLabel);
      if (!floorGroup) {
        floorGroup = { floor: floorLabel, rows: [] };
        building.floors.push(floorGroup);
      }
      floorGroup.rows.push({ item, index });
    });
    return Array.from(byBuilding.values());
  }, [items]);

  if (items.length === 0) {
    return (
      <p className="p-4 text-center text-muted-foreground">
        {t("activist_route.no_doors", "אין דלתות בסיבוב שלך")}
      </p>
    );
  }

  return (
    <div className="space-y-4 p-3">
      {groups.map((building) => (
        <div key={building.key} className="space-y-2">
          <div className="text-lg font-bold">{building.label}</div>
          {building.floors.map((floorGroup) => (
            <div key={floorGroup.floor} className="space-y-1">
              {floorGroup.floor && (
                <div className="text-xs font-medium text-muted-foreground">
                  {t("activist_route.divider.floor", "קומה {floor}").replace(
                    "{floor}",
                    floorGroup.floor,
                  )}
                </div>
              )}
              {floorGroup.rows.map(({ item, index }) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(index)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-start hover:bg-accent"
                >
                  <span>{apartmentTitle(item)}</span>
                  {item.jewish_status === "not_jewish" ? (
                    <span className="rounded-full bg-status-darkred px-2 py-0.5 text-xs font-semibold text-white">
                      {t("activist_route.grid.do_not_knock", "לא לדפוק")}
                    </span>
                  ) : item.last_outcome ? (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                      {t(OUTCOME_KEY[item.last_outcome], item.last_outcome)}
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {t("activist_route.grid.not_marked", "טרם סומן")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
