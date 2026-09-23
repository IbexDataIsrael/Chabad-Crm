/** fixes65 §1: the public pages' single signature mark — one hand-drawn
 *  swell of the bay under the organization's name. */
export function WaveRule({ className = "", color = "#D99A2B" }: { className?: string; color?: string }) {
  return (
    <svg
      viewBox="0 0 220 18"
      className={className}
      aria-hidden="true"
      fill="none"
      preserveAspectRatio="none"
    >
      <path
        d="M2 11 C 22 3, 40 3, 58 10 S 94 17, 112 10 S 148 2, 166 9 S 202 16, 218 8"
        stroke={color}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
