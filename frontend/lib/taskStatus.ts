import type { Task, TaskStatus } from "@/lib/types";

type Translate = (key: string, fallback: string) => string;

/** fixes74 §2/§5: AVAILABLE ("פנוי") = unassigned, ACTIVE ("נלקח") = taken.
 *  The stored value ACTIVE keeps its name, so older tasks read as "taken". */
export const TASK_STATUS_OPTIONS: TaskStatus[] = ["AVAILABLE", "ACTIVE", "COMPLETED", "PAUSED"];

export function taskStatusLabels(t: Translate): Record<TaskStatus, string> {
  return {
    AVAILABLE: t("task.status_available", "פנוי"),
    ACTIVE: t("task.status_active", "נלקח"),
    COMPLETED: t("task.status_completed", "הושלם"),
    PAUSED: t("task.status_paused", "מושהה"),
  };
}

/** The statuses a task can be switched to by hand: "available" and "taken"
 *  follow the assignment (the backend enforces the same rule). */
export function taskStatusOptionsFor(task: Pick<Task, "is_orphan">): TaskStatus[] {
  return TASK_STATUS_OPTIONS.filter((s) => (task.is_orphan ? s !== "ACTIVE" : s !== "AVAILABLE"));
}

/** fixes74 §1: the same signed link the printed QR encodes. */
export function taskClaimUrl(token: string): string {
  return `${window.location.origin}/tasks/claim/${token}`;
}
