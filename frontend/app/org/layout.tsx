import type { ReactNode } from "react";

// fixes65 §1: the public landing page originally loaded its own display face
// (Frank Ruhl) here. The redesign sets org names in the app-wide display face
// (Karantina, via the `font-display` utility), so this layout is now a plain
// passthrough — the /tasks/claim page still loads Frank Ruhl for its own
// summary card (see app/tasks/layout.tsx).
export default function PublicOrgLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
