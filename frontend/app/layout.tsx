import "./globals.css";
import type { Metadata } from "next";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "שיפסיידביי CRM",
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
      <body className="bg-gray-50 text-gray-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
