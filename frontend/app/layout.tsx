import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Karantina, Rubik } from "next/font/google";

import { Footer } from "@/components/Footer";
import { Providers } from "./providers";

const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-rubik",
  display: "swap",
});

const karantina = Karantina({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "700"],
  variable: "--font-karantina",
  display: "swap",
});

export const metadata: Metadata = {
  // Pre-hydration default only — TitleManager applies the configured template
  // ("{public.organizations.name} CRM" + fallback name) on every page (fixes9).
  title: "Jewish Points CRM",
  description: "Jewish Points — נקודות יהודיות",
  // The generated favicon package lives in /public (Next.js only auto-serves
  // arbitrary filenames from there, not from app/ — only the bare
  // favicon.ico convention is special-cased in app/) and needs explicit
  // <link> tags since these aren't Next's icon.*/apple-icon.* filenames.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

// The design system (tailwind.config.js tokens, status colors) is dark-only
// (redesign branch) — `color-scheme: dark` makes Android Chrome render native
// controls/scrollbars dark, matching the theme. (Previously "light" to stop
// Android's force-dark from mangling the OLD light theme's fixed/blur layers;
// with a real dark theme that renderer behavior is desirable.)
export const viewport: Viewport = {
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Native RTL layout: Hebrew is the primary UI language.
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} ${karantina.variable} overflow-x-hidden`}>
      {/* overflow-x-hidden on BOTH html and body: the mobile Sidebar drawer
          (components/layout/Sidebar.tsx) stays permanently mounted and is
          hidden via `translate-x-full` rather than unmounted/display:none. In
          RTL, a translated-off-canvas `position: fixed` element still extends
          the document's horizontal scrollable overflow, which leaves the page
          resting at a non-zero scroll offset — and that combination causes
          Chromium to visually mis-paint the fixed sidebar back on-screen (a
          real fixed-position/RTL/overflow paint bug, not just a layout
          number). `position: fixed` escapes the body's containing block, so
          overflow-x-hidden on body alone doesn't clip it — only the root
          (html) element's overflow actually clips fixed descendants, which is
          why both are needed here. */}
      <body className="bg-background text-foreground min-h-screen flex flex-col overflow-x-hidden">
        <Providers>
          <div className="flex-1">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
