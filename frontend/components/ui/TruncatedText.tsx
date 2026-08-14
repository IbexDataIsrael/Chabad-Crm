import { truncateText, GRID_TRUNCATE_LENGTH } from "@/lib/textFormat";

/**
 * fixes49 §1: grid cell free-text display — ellipsis at GRID_TRUNCATE_LENGTH
 * chars with the full value in a hover tooltip. `whitespace-nowrap` (not
 * `overflow:hidden`) so it never clips a sibling InlineEdit dropdown that
 * has to render past its own <td>.
 */
export function TruncatedText({
  text,
  max = GRID_TRUNCATE_LENGTH,
}: {
  text: string;
  max?: number;
}) {
  if (!text) return <>{text}</>;
  const short = truncateText(text, max);
  return (
    <span className="whitespace-nowrap" title={short !== text ? text : undefined}>
      {short}
    </span>
  );
}
