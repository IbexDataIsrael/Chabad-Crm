"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface SystemConfig {
  title_template: string;
  fallback_name: string;
}

const ORG_NAME_PLACEHOLDER = "{public.organizations.name}";

/** Sets the HTML <title> on every page from the superadmin-configured template
 *  (fixes9 §1): the placeholder is replaced with the logged-in organization's
 *  name, or the configured fallback name when no org name is available. */
export function TitleManager() {
  const { user } = useAuth();
  const [config, setConfig] = useState<SystemConfig | null>(null);

  // Public endpoint — fetched once at boot, before login.
  useEffect(() => {
    apiFetch<SystemConfig>("/api/metadata/system-config")
      .then(setConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!config) return;
    // With an org name the template applies; without one the fallback IS the
    // full title (the seed value "Jewish Points CRM" already carries "CRM" —
    // substituting it into "{…} CRM" would render "Jewish Points CRM CRM").
    const orgName = user?.organization?.name?.trim();
    const title = orgName
      ? config.title_template.split(ORG_NAME_PLACEHOLDER).join(orgName).trim()
      : config.fallback_name;
    document.title = title || config.fallback_name;
  }, [config, user]);

  return null;
}
