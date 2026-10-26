import { Frank_Ruhl_Libre } from "next/font/google";
import type { ReactNode } from "react";

// fixes65 §4: the QR claim page shares the org landing page's display face — a classic Hebrew
// print serif for the organization's name, set against the app's Rubik body (Karantina
// is the redesign's display face, via the `font-display` utility).
const frankRuhl = Frank_Ruhl_Libre({
  subsets: ["hebrew", "latin"],
  weight: ["500", "700", "900"],
  variable: "--font-frank-ruhl",
  display: "swap",
});

export default function PublicTasksLayout({ children }: { children: ReactNode }) {
  return <div className={frankRuhl.variable}>{children}</div>;
}
