import type { UserSummary } from "./types";

/**
 * fixes40 §2/§3: which org users may appear as options in a "Filter by
 * contact owner" dropdown. When the org has NOT opted "Activists may view
 * contacts" (`shliach_can_view_contacts`) on, shliach-role users are
 * excluded — used identically by the Contacts page and the Summary of
 * Visits report so the rule lives in exactly one place.
 */
export function visibleOwnerOptions(
  users: UserSummary[],
  activistsMayViewContacts: boolean,
): UserSummary[] {
  if (activistsMayViewContacts) return users;
  return users.filter((u) => u.role !== "shliach");
}
