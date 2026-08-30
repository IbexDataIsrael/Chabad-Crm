/** fixes52 §6: natural (alphanumeric) string compare — plain localeCompare
 *  sorts "10" before "2"; `numeric: true` fixes that. */
export const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
