"use client";

/**
 * BuildingCelebration.tsx
 * -----------------------
 * Celebration overlay for Street 2 (/dashboard/street2).
 * Fires when ALL apartments of a building are marked done:
 * multi-burst confetti falling from the top + a completion card
 * with a random Rebbe quote (from /rebbe-quotes.json) and a Rebbe photo
 * (from /rebbe/<n>.jpg). RTL, mobile-first.
 *
 * Dependency: canvas-confetti
 *   npm install canvas-confetti
 *   npm install -D @types/canvas-confetti
 *
 * Usage:
 *   <BuildingCelebration
 *     open={celebrationOpen}
 *     buildingLabel={building.name}        // optional, e.g. the building name/address
 *     onClose={() => setCelebrationOpen(false)}
 *   />
 *
 * Trigger it when the last undone apartment of a building flips to done:
 *   const allDone = building.apartments.every((a) => a.status === "done");
 *   if (allDone) setCelebrationOpen(true);
 */

import { useEffect, useState } from "react";
import confetti from "canvas-confetti";

import type { CelebrationItem, CelebrationQuote } from "@/lib/celebrationItems";
import { useLocalization } from "@/lib/localization";

type Quote = CelebrationQuote;

/** How many photos exist in public/rebbe/ (1.jpg .. N.jpg). Must match the files the user adds. */
const REBBE_IMAGE_COUNT = 9;

const FESTIVE_COLORS = [
  "#FFD700", // gold
  "#FF6B6B", // coral red
  "#4ECDC4", // teal
  "#45B7D1", // sky blue
  "#F9A826", // orange
  "#A78BFA", // purple
  "#FF85A1", // pink
];

/** Multi-burst confetti, all falling from the top. Total ~4.5 seconds. */
export function fireBuildingCelebration() {
  const end = Date.now() + 4500;

  // Opening blast: one big burst from the top center
  confetti({
    particleCount: 260,
    spread: 140,
    startVelocity: 42,
    origin: { x: 0.5, y: 0 },
    colors: FESTIVE_COLORS,
    scalar: 1.15,
  });

  // Steady rain from the two top corners + random points across the top edge
  const frame = () => {
    confetti({
      particleCount: 14,
      angle: 60,
      spread: 70,
      startVelocity: 35,
      origin: { x: 0, y: 0 },
      colors: FESTIVE_COLORS,
    });
    confetti({
      particleCount: 14,
      angle: 120,
      spread: 70,
      startVelocity: 35,
      origin: { x: 1, y: 0 },
      colors: FESTIVE_COLORS,
    });
    confetti({
      particleCount: 9,
      spread: 110,
      startVelocity: 28,
      origin: { x: Math.random(), y: 0 },
      colors: FESTIVE_COLORS,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();

  // A second big blast mid-way, from the top center
  setTimeout(() => {
    confetti({
      particleCount: 200,
      spread: 160,
      startVelocity: 38,
      origin: { x: 0.5, y: 0 },
      colors: FESTIVE_COLORS,
      shapes: ["circle", "square"],
    });
  }, 1800);
}

let cachedQuotes: Quote[] | null = null;

export async function loadQuotes(): Promise<Quote[]> {
  if (cachedQuotes) return cachedQuotes;
  try {
    const res = await fetch("/rebbe-quotes.json");
    const data = await res.json();
    cachedQuotes = data.quotes ?? [];
  } catch {
    cachedQuotes = [];
  }
  return cachedQuotes ?? [];
}

export default function BuildingCelebration({
  open,
  buildingLabel,
  onClose,
  item,
  milestoneCount,
}: {
  open: boolean;
  buildingLabel?: string;
  onClose: () => void;
  /** fixes98: show this (the next item of street2's merged list) instead
   *  of a random quote. */
  item?: CelebrationItem | null;
  /** fixes98: a "finished N more apartments" celebration, not a building. */
  milestoneCount?: number;
}) {
  const { t, dir } = useLocalization();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (item) {
      setQuote(item.kind === "quote" ? item.quote : null);
    } else {
      loadQuotes().then((quotes) => {
        if (quotes.length > 0) {
          setQuote(quotes[Math.floor(Math.random() * quotes.length)]);
        }
      });
    }
    setImgSrc(`/rebbe/${1 + Math.floor(Math.random() * REBBE_IMAGE_COUNT)}.jpg`);
    fireBuildingCelebration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const message = item?.kind === "message" ? item.text : null;

  if (!open) return null;

  return (
    <div
      dir={dir}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(20, 16, 40, 0.55)",
        padding: "16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(160deg, #fffdf5 0%, #fff3d6 100%)",
          border: "2px solid #FFD700",
          borderRadius: "20px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          maxWidth: "420px",
          width: "100%",
          padding: "28px 24px",
          textAlign: "center",
        }}
      >
        {imgSrc && (
          <img
            src={imgSrc}
            alt={t("street.celebration_rebbe_alt", "הרבי מליובאוויטש")}
            onError={() => setImgSrc(null)}
            style={{
              width: "120px",
              height: "120px",
              borderRadius: "50%",
              objectFit: "cover",
              border: "3px solid #FFD700",
              boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
              marginBottom: "14px",
            }}
          />
        )}

        <h2
          style={{
            margin: "0 0 4px 0",
            fontSize: "26px",
            fontWeight: 800,
            color: "#5b3d00",
          }}
        >
          {t("street.celebration_title", "כל הכבוד! 🎉")}
        </h2>
        <p style={{ margin: "0 0 18px 0", fontSize: "18px", color: "#7a5a10" }}>
          {milestoneCount != null
            ? t("street.celebration_milestone", "סיימת עוד {n} דירות!").replace("{n}", String(milestoneCount))
            : buildingLabel
              ? t("street.celebration_body", "סיימתם את הבניין - {name}!").replace("{name}", buildingLabel)
              : t("street.celebration_body_no_name", "סיימתם את הבניין!")}
        </p>

        {message && (
          <p
            style={{
              margin: "0 0 20px 0",
              padding: "14px 16px",
              background: "rgba(255, 215, 0, 0.12)",
              borderRadius: "12px",
              border: "1px solid rgba(255, 215, 0, 0.5)",
              fontSize: "17px",
              fontWeight: 600,
              color: "#3d2e05",
              whiteSpace: "pre-wrap",
            }}
          >
            {message}
          </p>
        )}

        {quote && (
          <blockquote
            style={{
              margin: "0 0 20px 0",
              padding: "14px 16px",
              background: "rgba(255, 215, 0, 0.12)",
              borderRadius: "12px",
              border: "1px solid rgba(255, 215, 0, 0.5)",
            }}
          >
            <p
              lang="he"
              style={{ margin: "0 0 8px 0", fontSize: "17px", fontWeight: 600, color: "#3d2e05" }}
            >
              {quote.he}
            </p>
            <p
              lang="en"
              dir="ltr"
              style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6b5a22", fontStyle: "italic" }}
            >
              {quote.en}
            </p>
            <footer style={{ fontSize: "11px", color: "#9a7b2d" }}>{quote.ref}</footer>
          </blockquote>
        )}

        <button
          onClick={onClose}
          style={{
            background: "linear-gradient(90deg, #F9A826, #FFD700)",
            border: "none",
            borderRadius: "999px",
            padding: "12px 32px",
            fontSize: "17px",
            fontWeight: 700,
            color: "#3d2e05",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(249,168,38,0.5)",
          }}
        >
          {t("street.celebration_continue", "המשך בדרך!")}
        </button>
      </div>
    </div>
  );
}
