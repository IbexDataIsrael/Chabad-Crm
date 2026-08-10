"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** fixes42 §4A: the Shluchim page merged into the unified Users page — this
 *  route stays alive as a redirect so old bookmarks/back-button history and
 *  any external links keep working. */
export default function ShluchimRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/users");
  }, [router]);
  return null;
}
