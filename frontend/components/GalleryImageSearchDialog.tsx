"use client";

import { Check, Images, Loader2, Search, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, importGalleryImage, searchPublicImages } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import type { PublicImageSearchResult } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fills the search box — the card passes the org name. */
  defaultQuery: string;
  /** The gallery as it is now, so imports never duplicate an existing photo. */
  existingUrls: string[];
  onImported: (urls: string[]) => void;
}

/**
 * fixes110: "search the web for images" for the public-page gallery. Calls
 * POST /api/organizations/public-image-search (Google Programmable Search),
 * lets the admin pick candidates, then imports each picked source through
 * POST /api/uploads/gallery-image-url — the backend downloads it and stores
 * it like a regular upload, so the gallery holds our own URLs, not hotlinks.
 * Nothing here auto-saves: onImported only appends to the card's gallery
 * state, persisted by the card's existing form save.
 */
export function GalleryImageSearchDialog({
  open,
  onClose,
  defaultQuery,
  existingUrls,
  onImported,
}: Props) {
  const { t } = useLocalization();
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<PublicImageSearchResult[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setQuery(defaultQuery);
      setResults([]);
      setSelected([]);
      setSearched(false);
      setError("");
      setImportedCount(0);
    }
  }, [open, defaultQuery]);

  if (!open) return null;

  async function runSearch(e?: FormEvent) {
    e?.preventDefault();
    if (searching || importing) return;
    const q = query.trim();
    if (!q) {
      setError(t("gallery.search_query_required", "יש להזין מילות חיפוש."));
      return;
    }
    setSearching(true);
    setError("");
    try {
      const found = await searchPublicImages(q);
      setResults(found);
      setSelected([]);
      setSearched(true);
    } catch (err) {
      setResults([]);
      setSearched(false);
      if (err instanceof ApiError && err.status === 503) {
        // Server-side keys missing — a plain user can't fix this; say so.
        setError(
          t(
            "gallery.search_not_configured",
            "חיפוש התמונות אינו מוגדר בשרת. יש להגדיר את משתני הסביבה GOOGLE_SEARCH_API_KEY ו-GOOGLE_SEARCH_CX ב-backend.",
          ),
        );
      } else {
        setError(err instanceof Error ? err.message : t("gallery.search_failed", "החיפוש נכשל"));
      }
    } finally {
      setSearching(false);
    }
  }

  function toggle(url: string) {
    setSelected((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  }

  async function addSelected() {
    if (!selected.length || importing) return;
    setImporting(true);
    setImportedCount(0);
    setError("");
    const added: string[] = [];
    try {
      // Sequential: each download+upload goes through the same pipeline as a
      // file upload, and the per-item progress is simpler to follow.
      for (const url of selected) {
        const ourUrl = await importGalleryImage(url);
        setImportedCount((n) => n + 1);
        if (!existingUrls.includes(ourUrl) && !added.includes(ourUrl)) {
          added.push(ourUrl);
        }
      }
      onImported(added);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("gallery.import_failed", "הייבוא נכשל"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl space-y-4 rounded-xl bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Images className="h-5 w-5" />
            {t("gallery.search_title", "חיפוש תמונות ברשת")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={runSearch} className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("gallery.search_placeholder", "חיפוש לפי שם הארגון או נושא…")}
            disabled={searching || importing}
          />
          <Button type="submit" variant="outline" disabled={searching || importing}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t("gallery.search_action", "חפש")}
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-96 overflow-y-auto">
          {searching ? (
            <p className="py-6 text-center text-muted-foreground">{t("action.loading", "טוען…")}</p>
          ) : searched && results.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              {t("gallery.search_empty", "לא נמצאו תמונות")}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {results.map((r) => {
                const isSelected = selected.includes(r.url);
                return (
                  <button
                    key={r.url}
                    type="button"
                    title={r.title}
                    onClick={() => toggle(r.url)}
                    disabled={importing}
                    className={`relative aspect-square overflow-hidden rounded-lg border disabled:opacity-50 ${
                      isSelected
                        ? "ring-2 ring-primary ring-offset-1 ring-offset-card"
                        : "border-border hover:ring-2 hover:ring-primary"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.thumbnail} alt={r.title} className="h-full w-full object-cover" />
                    {isSelected && (
                      <span className="absolute top-1 end-1 rounded-full bg-primary p-1 text-primary-foreground shadow">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {importing
              ? t(
                  "gallery.importing_progress",
                  "מייבא תמונה {done} מתוך {total}…",
                ).replace("{done}", String(importedCount)).replace("{total}", String(selected.length))
              : t(
                  "gallery.search_hint",
                  "התמונות יורדות לשרת שלנו ואינן תלויות באתר המקור. הנתונים נשמרים רק עם שמירת הטופס.",
                )}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={importing}>
              {t("action.cancel", "ביטול")}
            </Button>
            <Button type="button" onClick={addSelected} disabled={!selected.length || searching || importing}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {importing
                ? t("gallery.importing", "מייבא…")
                : t("gallery.import_selected", "הוסף לגלריה ({count})").replace(
                    "{count}",
                    String(selected.length),
                  )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
