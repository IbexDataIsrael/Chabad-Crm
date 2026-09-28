import type { Metadata } from "next";

import { serverFetchPublic } from "@/lib/serverApi";
import type { PublicOrg } from "@/lib/types";

import { OrgPageClient } from "./OrgPageClient";

/** fixes69 Bug 2: a social-preview crawler (WhatsApp, etc.) never runs client
 *  JS, so TitleManager's document.title/pageOrg trick (client-side only) is
 *  invisible to it — every org's self-registration link previewed as the
 *  generic app title with no logo. generateMetadata runs server-side, so the
 *  preview gets the real org name + logo, per org. */
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const org = await serverFetchPublic<PublicOrg>(
    `/api/public/orgs/${encodeURIComponent(params.slug)}`,
  );
  if (!org) return {};
  const description = org.subtitle || undefined;
  const images = org.logo_url ? [{ url: org.logo_url }] : undefined;
  return {
    title: org.name,
    description,
    openGraph: { title: org.name, description, images },
    twitter: { card: "summary", title: org.name, description, images },
  };
}

export default function PublicOrgPage() {
  return <OrgPageClient />;
}
