"use client";

import { useEffect, useState } from "react";

import { useLocalization } from "@/lib/localization";

interface Quote {
  he: string;
  en: string;
  source: string;
}
interface Manifest {
  photos: string[];
}

let assetsPromise: Promise<{ manifest: Manifest; quotes: Quote[] }> | null = null;

function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      fetch("/rebbe/manifest.json")
        .then((r) => (r.ok ? r.json() : { photos: [] }))
        .catch(() => ({ photos: [] })) as Promise<Manifest>,
      fetch("/rebbe/quotes.json")
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []) as Promise<Quote[]>,
    ]).then(([manifest, quotes]) => ({ manifest, quotes }));
  }
  return assetsPromise;
}

/** fixes68 §7: Rebbe photo/quote rotation inside a DividerCard slot.
 *  HARD RULE: renders nothing until Zvi drops real assets into
 *  public/rebbe/ — no placeholder quote, no stock text, no hotlinked image
 *  (manifest.json/quotes.json ship empty). Alternates photo/quote by
 *  `index` (dividers seen this route — deterministic, never repeats
 *  mid-cycle), each kind cycling through its own list independently. */
export function RebbeInspiration({ index }: { index: number }) {
  const { lang } = useLocalization();
  const [assets, setAssets] = useState<{ manifest: Manifest; quotes: Quote[] } | null>(null);

  useEffect(() => {
    let active = true;
    loadAssets().then((data) => {
      if (active) setAssets(data);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!assets) return null;
  const { manifest, quotes } = assets;
  const hasPhotos = manifest.photos.length > 0;
  const hasQuotes = quotes.length > 0;
  if (!hasPhotos && !hasQuotes) return null;

  const wantsPhoto = index % 2 === 0;
  const showPhoto = (wantsPhoto && hasPhotos) || (!wantsPhoto && !hasQuotes && hasPhotos);

  if (showPhoto) {
    const photo = manifest.photos[Math.floor(index / 2) % manifest.photos.length];
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/rebbe/photos/${photo}`}
        alt=""
        className="max-h-[40vh] w-full rounded-xl object-cover"
      />
    );
  }

  const quote = quotes[Math.floor(index / 2) % quotes.length];
  const text = lang === "en" && quote.en ? quote.en : quote.he;
  return (
    <div className="space-y-1 px-2 text-center">
      <p className="text-lg italic">&ldquo;{text}&rdquo;</p>
      {quote.source && <p className="text-sm text-muted-foreground">{quote.source}</p>}
    </div>
  );
}
