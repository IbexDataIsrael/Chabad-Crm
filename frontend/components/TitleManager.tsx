"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePageOrg } from "@/lib/pageOrg";

interface SystemConfig {
  title_template: string;
  fallback_name: string;
}

const ORG_NAME_PLACEHOLDER = "{public.organizations.name}";

/** fixes65: point every <link rel="icon"/"apple-touch-icon"> at the org's
 *  logo, or back at the app's own icons when `logoUrl` is null. The
 *  originals are remembered on the element itself, so restoring is exact.
 *  `type` is dropped while overridden — a logo may be jpg/webp, and a
 *  mismatched type="image/png" makes browsers skip the icon. */
function applyFavicon(logoUrl: string | null) {
  const links = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
  );
  links.forEach((link) => {
    if (link.dataset.defaultHref === undefined) {
      link.dataset.defaultHref = link.getAttribute("href") ?? "";
      link.dataset.defaultType = link.getAttribute("type") ?? "";
    }
    if (logoUrl) {
      if (link.getAttribute("href") !== logoUrl) link.setAttribute("href", logoUrl);
      link.removeAttribute("type");
    } else {
      link.setAttribute("href", link.dataset.defaultHref ?? "");
      if (link.dataset.defaultType) link.setAttribute("type", link.dataset.defaultType);
    }
  });
}

/** Sets the HTML <title> on every page from the superadmin-configured template
 *  (fixes9 §1): the placeholder is replaced with the logged-in organization's
 *  name, or the configured fallback name when no org name is available. */
export function TitleManager() {
  const { user } = useAuth();
  // fixes65: a public org page (/org/<slug>, a QR claim link) names its org
  // before anyone is logged in.
  const pageOrg = usePageOrg();
  // fixes12 §1: the App Router re-stamps the static metadata title on every
  // client-side navigation, wiping the computed one — re-apply per pathname.
  const pathname = usePathname();
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
    const orgName = user?.organization?.name?.trim() || pageOrg?.name?.trim();
    const title = orgName
      ? config.title_template.split(ORG_NAME_PLACEHOLDER).join(orgName).trim()
      : config.fallback_name;
    document.title = title || config.fallback_name;
  }, [config, user, pathname, pageOrg]);

  // fixes65: the tab icon is the org's own logo wherever the org is known.
  const logoUrl = user?.organization?.logo_url || pageOrg?.logoUrl || null;
  useEffect(() => {
    applyFavicon(logoUrl);
  }, [logoUrl, pathname]);

  return null;
}
