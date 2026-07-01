"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useLocalization } from "@/lib/localization";

// The old staff self-registration is replaced by organization signup.
export default function RegisterRedirect() {
  const router = useRouter();
  const { t } = useLocalization();
  useEffect(() => {
    router.replace("/signup");
  }, [router]);
  return (
    <div className="p-8 text-center text-gray-400">
      {t("msg.redirecting", "מעביר…")}
    </div>
  );
}
