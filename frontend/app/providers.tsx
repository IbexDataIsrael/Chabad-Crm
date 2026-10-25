"use client";

import type { ReactNode } from "react";

import { AiHelperWidget } from "@/components/ai-helper/AiHelperWidget";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";
import { TitleManager } from "@/components/TitleManager";
import { AuthProvider } from "@/lib/auth";
import { ConfirmProvider } from "@/lib/confirm";
import { FieldSettingsProvider } from "@/lib/fieldSettings";
import { LocalizationProvider } from "@/lib/localization";
import { ToastProvider } from "@/lib/toast";

// The AI helper popup isn't connected yet — hidden unless explicitly turned on
// (NEXT_PUBLIC_AI_HELPER_ENABLED=true, read at build time).
const AI_HELPER_ENABLED = process.env.NEXT_PUBLIC_AI_HELPER_ENABLED === "true";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ClientErrorReporter />
      <TitleManager />
      <LocalizationProvider>
        {AI_HELPER_ENABLED && <AiHelperWidget />}
        <ToastProvider>
          <ConfirmProvider>
            <FieldSettingsProvider>{children}</FieldSettingsProvider>
          </ConfirmProvider>
        </ToastProvider>
      </LocalizationProvider>
    </AuthProvider>
  );
}
