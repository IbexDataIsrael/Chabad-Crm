import type { CSSProperties } from "react";

// The five status markers (matching the spreadsheet + Tailwind status palette).
export const COLOR_HEX: Record<string, string> = {
  magenta: "#d6006e",
  green: "#1faa00",
  yellow: "#f2c200",
  darkred: "#8b0000",
  orange: "#ff7a00",
};

/** Light tint + colored inline-start border for a contact row. */
export function rowStyle(colorTag: string | null | undefined): CSSProperties {
  const hex = colorTag ? COLOR_HEX[colorTag] : undefined;
  if (!hex) return {};
  return {
    backgroundColor: `${hex}14`, // ~8% alpha
    borderInlineStartWidth: "4px",
    borderInlineStartStyle: "solid",
    borderInlineStartColor: hex,
  };
}

/** Solid swatch for a color tag (falls back to grey). */
export function dotStyle(colorTag: string | null | undefined): CSSProperties {
  const hex = colorTag ? COLOR_HEX[colorTag] : undefined;
  return { backgroundColor: hex ?? "#d1d5db" };
}
