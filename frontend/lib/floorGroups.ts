/**
 * fixes77: splits ONE building's apartments into floor groups for the street2
 * floor dividers. Presentation only — the input is expected to arrive already
 * floor-sorted by the backend (configured Floor.sort_order, then natural
 * order), so groups keep first-seen floor order and each group keeps its
 * received apartment order. Never re-sorts: an alphabetical sort here would
 * break configured floor order and put "10" before "2".
 *
 * Keyed by the stored floor NAME (`floor ?? ""`): null and "" share one
 * unknown-floor group (`floor: null`); every other string — "L", "קרקע",
 * "0", " 1" — stays its own group, untrimmed. Each apartment appears exactly
 * once. Call per building; never mix buildings in one call.
 */
export function groupByFloor<T extends { floor: string | null }>(
  apartments: readonly T[],
): { floor: string | null; apartments: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const a of apartments) {
    const key = a.floor ?? "";
    const group = groups.get(key);
    if (group) group.push(a);
    else groups.set(key, [a]);
  }
  return Array.from(groups, ([key, list]) => ({ floor: key === "" ? null : key, apartments: list }));
}
