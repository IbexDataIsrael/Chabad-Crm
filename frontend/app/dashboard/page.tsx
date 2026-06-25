"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The CRM's working landing page is the contacts list.
export default function DashboardHome() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/contacts");
  }, [router]);
  return <p className="p-8 text-center text-gray-400">טוען…</p>;
}
