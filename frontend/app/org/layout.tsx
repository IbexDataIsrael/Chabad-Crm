import { Frank_Ruhl_Libre } from "next/font/google";
import type { ReactNode } from "react";

// fixes65 §1: the public landing page's display face — a classic Hebrew
// print serif for the organization's name, set against the app's Heebo body.
const frankRuhl = Frank_Ruhl_Libre({
  subsets: ["hebrew", "latin"],
  weight: ["500", "700", "900"],
  variable: "--font-frank-ruhl",
  display: "swap",
});

export default function PublicOrgLayout({ children }: { children: ReactNode }) {
  return <div className={frankRuhl.variable}>{children}</div>;
}
