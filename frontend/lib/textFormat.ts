// fixes49 §1: grid cell text truncation — cells beyond this length get an
// ellipsis + full-text tooltip instead of wrapping mid-word.
export const GRID_TRUNCATE_LENGTH = 20;

export function truncateText(text: string, max: number = GRID_TRUNCATE_LENGTH): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
