import type { Metadata } from "next";

import { serverFetchPublic } from "@/lib/serverApi";
import type { ClaimInfo } from "@/lib/types";

import { ClaimTaskPageClient } from "./ClaimTaskPageClient";

/** fixes69 Bug 2: a social-preview crawler (WhatsApp, etc.) never runs client
 *  JS, so TitleManager's document.title/pageOrg trick (client-side only) is
 *  invisible to it — sharing a printed task sheet's QR link previewed as the
 *  generic app title with no logo. generateMetadata runs server-side, so the
 *  preview gets the real org name + logo, per org. GET /api/public/claim
 *  works unauthenticated (that's exactly how the client page already calls
 *  it before login) — a crawler request carries no bearer token either way,
 *  so the state below is always the generic public one, never a specific
 *  activist's ("yours"/"taken"). */
export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const info = await serverFetchPublic<ClaimInfo>(
    `/api/public/claim/${encodeURIComponent(params.token)}`,
  );
  if (!info || !info.organization_name) return {};
  const title = info.organization_name;
  const images = info.organization_logo_url ? [{ url: info.organization_logo_url }] : undefined;
  return {
    title,
    openGraph: { title, images },
    twitter: { card: "summary", title, images },
  };
}

export default function ClaimTaskPage() {
  return <ClaimTaskPageClient />;
}
