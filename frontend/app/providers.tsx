"use client";

import type { ReactNode } from "react";

import { TitleManager } from "@/components/TitleManager";
import { AuthProvider } from "@/lib/auth";
import { FieldSettingsProvider } from "@/lib/fieldSettings";
import { LocalizationProvider } from "@/lib/localization";
import { ToastProvider } from "@/lib/toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <TitleManager />
      <LocalizationProvider>
        <ToastProvider>
          <FieldSettingsProvider>{children}</FieldSettingsProvider>
        </ToastProvider>
      </LocalizationProvider>
    </AuthProvider>
  );
}
