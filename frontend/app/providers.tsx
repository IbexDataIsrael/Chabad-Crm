"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "@/lib/auth";
import { FieldSettingsProvider } from "@/lib/fieldSettings";
import { LocalizationProvider } from "@/lib/localization";
import { ToastProvider } from "@/lib/toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <LocalizationProvider>
        <ToastProvider>
          <FieldSettingsProvider>{children}</FieldSettingsProvider>
        </ToastProvider>
      </LocalizationProvider>
    </AuthProvider>
  );
}
