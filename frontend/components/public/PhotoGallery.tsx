"use client";

import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocalization } from "@/lib/localization";

/** fixes65 §1: the landing page's photo gallery — a real gallery, not a
 *  static strip: swipe (touch/pointer), arrow keys, thumbnails, and a
 *  full-screen lightbox. RTL-aware: "next" moves toward the reading
 *  direction's end (leftward in Hebrew). */
export function PhotoGallery({
  images,
  orgName,
  className = "",
  frameClassName = "",
  showThumbnails = true,
}: {
  images: string[];
  orgName: string;
  className?: string;
  /** Size/shape of the photo frame itself (also the empty-state panel). */
  frameClassName?: string;
  showThumbnails?: boolean;
}) {
  const { t, dir } = useLocalization();
  const rtl = dir === "rtl";
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const dragStartX = useRef<number | null>(null);
  const count = images.length;

  const go = useCallback(
    (delta: number) => setIndex((i) => (count ? (i + delta + count) % count : 0)),
    [count],
  );

  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(false);
      if (e.key === "ArrowLeft") go(rtl ? 1 : -1);
      if (e.key === "ArrowRight") go(rtl ? -1 : 1);
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightbox, go, rtl]);

  function onPointerDown(e: React.PointerEvent) {
    dragStartX.current = e.clientX;
  }
  function onPointerUp(e: React.PointerEvent) {
    if (dragStartX.current == null) return;
    const dx = e.clientX - dragStartX.current;
    dragStartX.current = null;
    if (Math.abs(dx) < 40) return;
    // Swiping content toward the reading start reveals the next photo.
    const towardLeft = dx < 0;
    go(towardLeft === rtl ? -1 : 1);
  }

  if (count === 0) {
    return (
      <div
        className={`relative overflow-hidden bg-card ${className} ${frameClassName}`}
        aria-hidden="true"
      >
        <svg className="absolute inset-0 h-full w-full text-primary/25" preserveAspectRatio="none">
          <defs>
            <pattern id="bay-waves" width="120" height="28" patternUnits="userSpaceOnUse">
              <path
                d="M0 14 C 20 4, 40 4, 60 14 S 100 24, 120 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#bay-waves)" />
        </svg>
      </div>
    );
  }

  const PrevIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;
  const navButton =
    "flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white shadow-md " +
    "backdrop-blur transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

  return (
    <div className={`relative ${className}`}>
      <div
        className={`relative w-full touch-pan-y select-none overflow-hidden bg-card ${frameClassName}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        role="region"
        aria-roledescription={t("public.gallery", "גלריית תמונות")}
        aria-label={orgName}
      >
        {images.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src + i}
            src={src}
            alt={t("public.gallery_photo_alt", "תמונה {n} מתוך {total}")
              .replace("{n}", String(i + 1))
              .replace("{total}", String(count))}
            draggable={false}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 motion-reduce:transition-none ${
              i === index ? "opacity-100" : "opacity-0"
            }`}
            loading={i === 0 ? "eager" : "lazy"}
          />
        ))}

        {count > 1 && (
          <div className="absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between">
            <button type="button" className={navButton} onClick={() => go(-1)} aria-label={t("public.gallery_prev", "התמונה הקודמת")}>
              <PrevIcon className="h-5 w-5" />
            </button>
            <button type="button" className={navButton} onClick={() => go(1)} aria-label={t("public.gallery_next", "התמונה הבאה")}>
              <NextIcon className="h-5 w-5" />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="absolute end-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition hover:bg-black/55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          aria-label={t("public.gallery_fullscreen", "הצגה במסך מלא")}
        >
          <Expand className="h-4 w-4" />
        </button>
      </div>

      {showThumbnails && count > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist">
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={String(i + 1)}
              onClick={() => setIndex(i)}
              className={`h-14 w-20 shrink-0 overflow-hidden rounded-md ring-offset-2 ring-offset-card transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                i === index ? "ring-2 ring-[#D99A2B]" : "opacity-60 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1F27]/95 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={orgName}
          onClick={() => setLightbox(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[index]}
            alt=""
            className="max-h-[88vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
          />
          <button
            type="button"
            autoFocus
            onClick={() => setLightbox(false)}
            className="absolute end-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label={t("action.close", "סגירה")}
          >
            <X className="h-5 w-5" />
          </button>
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  go(-1);
                }}
                className="absolute start-4 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label={t("public.gallery_prev", "התמונה הקודמת")}
              >
                <PrevIcon className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  go(1);
                }}
                className="absolute end-4 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label={t("public.gallery_next", "התמונה הבאה")}
              >
                <NextIcon className="h-6 w-6" />
              </button>
              <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/70" dir="ltr">
                {index + 1} / {count}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
