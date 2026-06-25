"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "@/lib/auth";
import { LocalizationProvider } from "@/lib/localization";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <LocalizationProvider>{children}</LocalizationProvider>
    </AuthProvider>
  );
}
