"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "./api";
import type { CampaignActive } from "./types";

/** fixes71 §B.6/§C.5: the org's one active campaign and which apartment
 *  fields it hides — only street2 consumes this (unlike the app-wide
 *  useFieldSettings), so a plain fetch-on-mount hook rather than a context
 *  provider. No active campaign at all -> isVisible always true (least
 *  surprising default: nothing is hidden until an admin sets one up). */
export function useActiveCampaignFieldVisibility() {
  const [loading, setLoading] = useState(true);
  const [campaign, setCampaign] = useState<CampaignActive | null>(null);

  useEffect(() => {
    apiFetch<CampaignActive | null>("/api/campaigns/active")
      .then(setCampaign)
      .catch(() => setCampaign(null))
      .finally(() => setLoading(false));
  }, []);

  function isVisible(fieldKey: string): boolean {
    if (!campaign) return true;
    return !campaign.hidden_field_keys.includes(fieldKey);
  }

  return { loading, campaign, isVisible };
}
