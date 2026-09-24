import { useSyncExternalStore } from "react";

/** fixes65: the organization a *public* page belongs to (/org/<slug>, a QR
 *  claim link) — known before anyone logs in, so TitleManager can brand the
 *  browser tab (name + logo icon) there too. null everywhere else. */
export interface PageOrg {
  name: string;
  logoUrl: string | null;
}

let pageOrg: PageOrg | null = null;
const listeners = new Set<() => void>();

export function setPageOrg(org: PageOrg | null): void {
  if (org?.name === pageOrg?.name && org?.logoUrl === pageOrg?.logoUrl) return;
  pageOrg = org;
  listeners.forEach((l) => l());
}

export function usePageOrg(): PageOrg | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pageOrg,
    () => null,
  );
}
