"use client";

import type { ReactNode } from "react";

import { ClientErrorReporter } from "@/components/ClientErrorReporter";
import { TitleManager } from "@/components/TitleManager";
import { AuthProvider } from "@/lib/auth";
import { ConfirmProvider } from "@/lib/confirm";
import { FieldSettingsProvider } from "@/lib/fieldSettings";
import { LocalizationProvider } from "@/lib/localization";
import { ToastProvider } from "@/lib/toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ClientErrorReporter />
      <TitleManager />
      <LocalizationProvider>
        <ToastProvider>
          <ConfirmProvider>
            <FieldSettingsProvider>{children}</FieldSettingsProvider>
          </ConfirmProvider>
        </ToastProvider>
      </LocalizationProvider>
    </AuthProvider>
  );
}
