import "./globals.css";
import type { Metadata } from "next";

import { Footer } from "@/components/Footer";
import { Providers } from "./providers";

export const metadata: Metadata = {
  // Pre-hydration default only — TitleManager applies the configured template
  // ("{public.organizations.name} CRM" + fallback name) on every page (fixes9).
  title: "Jewish Points CRM",
  description: "Bilingual Hebrew/English Mini CRM",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Native RTL layout: Hebrew is the primary UI language.
  return (
    <html lang="he" dir="rtl">
      <body className="bg-gray-50 text-gray-900 min-h-screen flex flex-col">
        <Providers>
          <div className="flex-1">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
