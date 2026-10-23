/** fixes109: date + time display for tasks.
 *
 *  Two kinds of timestamps come back from the API, both without a zone:
 *  - server-stamped ones (created_at, …) are UTC (`datetime.utcnow`), so a
 *    "Z" is added before converting to the viewer's local time;
 *  - the task's own date & time (`scheduled_at`) is the wall-clock time the
 *    admin typed, so it is shown exactly as stored. */

const FORMAT: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

function format(d: Date): string {
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("he-IL", FORMAT);
}

export function formatServerDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return format(new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`));
}

export function formatWallDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  // No zone suffix → the browser reads it as local time, i.e. as typed.
  return format(new Date(iso.replace(/(Z|[+-]\d\d:\d\d)$/, "")));
}

/** The value for an `<input type="datetime-local">` ("YYYY-MM-DDTHH:mm"). */
export function toDateTimeLocalInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 16) : "";
}
