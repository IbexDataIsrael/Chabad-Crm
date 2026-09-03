"use client";

import { Upload, X } from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch, uploadAnnouncementImage } from "@/lib/api";
import { useLocalization } from "@/lib/localization";

interface GalleryImage {
  url: string;
  public_id: string;
  created_at?: string;
}

/**
 * fixes56 §2: org-scoped image gallery + upload for RichTextEditor's
 * optional image-picker toolbar button. Both endpoints it calls
 * (/api/uploads/announcement-image[s]) are admin-only and resolve the
 * organization from the caller's JWT server-side — this component never
 * sends an org id — so one org can never see or add to another org's
 * gallery.
 */
export function ImagePickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ images: GalleryImage[] }>("/api/uploads/announcement-images")
      .then((res) => setImages(res.images))
      .catch(() => setError(t("image_picker.load_failed", "טעינת התמונות נכשלה")))
      .finally(() => setLoading(false));
  }, [t]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const url = await uploadAnnouncementImage(file);
      onSelect(url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("image_picker.upload_failed", "העלאת התמונה נכשלה"),
      );
    } finally {
      setUploading(false);
      e.target.value = ""; // allow re-picking the same file
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl bg-card rounded-xl shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{t("image_picker.title", "בחר תמונה")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" />
          {uploading ? t("action.saving", "מעלה…") : t("image_picker.upload_new", "העלה תמונה חדשה")}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFile}
            disabled={uploading}
          />
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-96 overflow-y-auto">
          {loading ? (
            <p className="py-6 text-center text-muted-foreground">{t("action.loading", "טוען…")}</p>
          ) : images.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              {t("image_picker.none", "אין עדיין תמונות שמורות — העלה תמונה חדשה.")}
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {images.map((img) => (
                <button
                  key={img.public_id}
                  type="button"
                  onClick={() => onSelect(img.url)}
                  className="aspect-square rounded-lg border border-border overflow-hidden hover:ring-2 hover:ring-primary focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("action.cancel", "ביטול")}
          </Button>
        </div>
      </div>
    </div>
  );
}
