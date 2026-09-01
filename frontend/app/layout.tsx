import "./globals.css";
import type { Metadata } from "next";
import { Heebo } from "next/font/google";

import { Footer } from "@/components/Footer";
import { Providers } from "./providers";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-heebo",
  display: "swap",
});

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
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="bg-background text-foreground min-h-screen flex flex-col">
        <Providers>
          <div className="flex-1">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
