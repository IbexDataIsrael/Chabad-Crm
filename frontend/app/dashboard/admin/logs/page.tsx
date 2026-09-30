"use client";

import { LogsView } from "@/components/LogsView";

/** fixes83: the superadmin's cross-org logs (entries + errors, org-named). */
export default function AdminLogsPage() {
  return <LogsView platform />;
}
