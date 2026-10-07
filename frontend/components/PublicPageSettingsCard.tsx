"use client";

import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/RichTextEditor";
import { apiFetch, ApiError, uploadGalleryImage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { OrgDetails } from "@/lib/types";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** fixes65 §1: the org's branded public page — address (slug), subtitle,
 *  photo gallery and the self-registration switch, all editable without a
 *  deploy. The page title is the org name from the card above. */
export function PublicPageSettingsCard() {
  const { t } = useLocalization();
  const { refresh } = useAuth();
  const { success, error: toastError } = useToast();
  const [slug, setSlug] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [subtitleEn, setSubtitleEn] = useState(""); // fixes85
  const [gallery, setGallery] = useState<string[]>([]);
  const [selfRegistration, setSelfRegistration] = useState(false);
  const [publicFooterHtml, setPublicFooterHtml] = useState("");
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // Live uniqueness check of the address against every other org.
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

  const cleanSlug = slug.trim().toLowerCase();
  const slugFormatOk = !cleanSlug || SLUG_RE.test(cleanSlug);

  useEffect(() => {
    if (!cleanSlug || !slugFormatOk || cleanSlug === savedSlug) {
      setSlugStatus("idle");
      return;
    }
    setSlugStatus("checking");
    let active = true;
    const handle = setTimeout(() => {
      apiFetch<{ available: boolean }>(
        `/api/organizations/slug-available?slug=${encodeURIComponent(cleanSlug)}`,
      )
        .then((r) => active && setSlugStatus(r.available ? "available" : "taken"))
        .catch(() => active && setSlugStatus("idle"));
    }, 350);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [cleanSlug, slugFormatOk, savedSlug]);

  useEffect(() => {
    apiFetch<OrgDetails>("/api/organizations/me")
      .then((o) => {
        setSlug(o.slug ?? "");
        setSavedSlug(o.slug ?? null);
        setSubtitle(o.public_subtitle ?? "");
        setSubtitleEn(o.public_subtitle_en ?? "");
        setGallery(o.public_gallery ?? []);
        setSelfRegistration(o.self_registration_enabled ?? false);
        setPublicFooterHtml(o.public_footer_html ?? "");
      })
      .catch(() => {});
  }, []);

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const url = await uploadGalleryImage(file);
        setGallery((g) => [...g, url]);
      } catch (err) {
        toastError(err instanceof Error ? err.message : t("gallery.upload_failed", "העלאת התמונה נכשלה"));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function move(i: number, delta: -1 | 1) {
    setGallery((g) => {
      const j = i + delta;
      if (j < 0 || j >= g.length) return g;
      const next = [...g];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!slugFormatOk) {
      setError(t("public_settings.slug_invalid", "כתובת הדף יכולה להכיל רק אותיות באנגלית, ספרות ומקפים."));
      return;
    }
    if (slugStatus === "taken") {
      setError(t("public_settings.slug_taken", "כתובת זו כבר בשימוש על ידי ארגון אחר. יש לבחור כתובת אחרת."));
      return;
    }
    setBusy(true);
    try {
      const o = await apiFetch<OrgDetails>("/api/organizations/me", {
        method: "PUT",
        body: JSON.stringify({
          slug: cleanSlug || null,
          public_subtitle: subtitle.trim() || null,
          public_subtitle_en: subtitleEn.trim() || null,
          public_gallery: gallery,
          self_registration_enabled: selfRegistration,
          public_footer_html: publicFooterHtml.trim() || null,
        }),
      });
      setSavedSlug(o.slug ?? null);
      setSlug(o.slug ?? "");
      await refresh();
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 409
          ? t("public_settings.slug_taken", "כתובת זו כבר בשימוש על ידי ארגון אחר. יש לבחור כתובת אחרת.")
          : err instanceof Error
            ? err.message
            : t("msg.save_failed", "שמירה נכשלה");
      if (err instanceof ApiError && err.status === 409) setSlugStatus("taken");
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  const publicUrl =
    savedSlug && typeof window !== "undefined" ? `${window.location.origin}/org/${savedSlug}` : null;

  return (
    <Card className="p-0">
      <form onSubmit={save} className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">{t("public_settings.title", "דף הארגון הציבורי")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              "public_settings.hint",
              "דף נחיתה ממותג עם שם הארגון, כותרת משנה וגלריית תמונות, שממנו פעילים מתחברים ונרשמים.",
            )}
          </p>
        </div>

        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("public_settings.slug", "כתובת הדף")}</span>
          <div className="flex items-center gap-1" dir="ltr">
            <span className="text-sm text-muted-foreground">/org/</span>
            <Input
              dir="ltr"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-organization"
              aria-invalid={!slugFormatOk || slugStatus === "taken"}
              className={
                !slugFormatOk || slugStatus === "taken"
                  ? "border-status-darkred focus-visible:ring-status-darkred"
                  : undefined
              }
            />
          </div>
          {!slugFormatOk ? (
            <p className="text-xs text-status-darkred">
              {t("public_settings.slug_invalid", "כתובת הדף יכולה להכיל רק אותיות באנגלית, ספרות ומקפים.")}
            </p>
          ) : slugStatus === "taken" ? (
            <p className="text-xs text-status-darkred">
              {t("public_settings.slug_taken", "כתובת זו כבר בשימוש על ידי ארגון אחר. יש לבחור כתובת אחרת.")}
            </p>
          ) : slugStatus === "available" ? (
            <p className="text-xs text-success">
              {t("public_settings.slug_available", "הכתובת פנויה ✓")}
            </p>
          ) : slugStatus === "checking" ? (
            <p className="text-xs text-muted-foreground">
              {t("public_settings.slug_checking", "בודק זמינות…")}
            </p>
          ) : null}
          {publicUrl && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              dir="ltr"
            >
              {publicUrl} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </label>

        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("public_settings.subtitle", "כותרת משנה")}</span>
          <textarea
            className="w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={2}
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="block text-sm font-medium">
            {t("public_settings.subtitle_en", "כותרת משנה באנגלית")}
          </span>
          <textarea
            dir="ltr"
            className="w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={2}
            value={subtitleEn}
            onChange={(e) => setSubtitleEn(e.target.value)}
          />
          <span className="block text-xs text-muted-foreground">
            {t("public_settings.subtitle_en_hint", "מוצגת כשדף הארגון מוצג באנגלית. ריק = כותרת המשנה בעברית.")}
          </span>
        </label>

        <div className="space-y-2">
          <span className="block text-sm font-medium">{t("public_settings.gallery", "גלריית תמונות")}</span>
          {gallery.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {gallery.map((url, i) => (
                <li key={url + i} className="group relative overflow-hidden rounded-md border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="aspect-[4/3] w-full object-cover" />
                  <div className="absolute inset-x-1 bottom-1 flex justify-between">
                    <span className="flex gap-1">
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        className="rounded bg-white/90 p-1 text-foreground shadow disabled:opacity-30"
                        aria-label={t("action.move_up", "העלה")}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={i === gallery.length - 1}
                        onClick={() => move(i, 1)}
                        className="rounded bg-white/90 p-1 text-foreground shadow disabled:opacity-30"
                        aria-label={t("action.move_down", "הורד")}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </span>
                    <button
                      type="button"
                      onClick={() => setGallery((g) => g.filter((_, j) => j !== i))}
                      className="rounded bg-white/90 p-1 text-status-darkred shadow"
                      aria-label={t("action.delete", "מחק")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => addImages(e.target.files)}
          />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
            {uploading > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {t("public_settings.add_photos", "הוספת תמונות")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("public_settings.gallery_hint", "התמונה הראשונה היא תמונת הפתיחה. עד 24 תמונות.")}
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selfRegistration}
            onChange={(e) => setSelfRegistration(e.target.checked)}
          />
          {t("public_settings.self_registration", "פתיחת הרשמה עצמית לפעילים")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t(
            "public_settings.self_registration_hint",
            "כאשר פעיל, כל אחד יכול להירשם כפעיל מדף הארגון ולקבל גישה מיידית. המנהלים יקבלו הודעה במייל על כל הרשמה.",
          )}
        </p>

        <div className="space-y-2">
          <span className="block text-sm font-medium">
            {t("public_settings.footer_html", "תוכן חופשי בתחתית דף ההתחברות (WYSIWYG)")}
          </span>
          <p className="text-xs text-muted-foreground">
            {t(
              "public_settings.footer_html_hint",
              "תוכן מעוצב או קוד HTML שיוצג בחלק התחתון של דף הארגון הציבורי.",
            )}
          </p>
          <RichTextEditor
            value={publicFooterHtml}
            onChange={setPublicFooterHtml}
            imagePicker={async () => {
              const fileInput = document.createElement("input");
              fileInput.type = "file";
              fileInput.accept = "image/*";
              return new Promise((resolve) => {
                fileInput.onchange = async () => {
                  const file = fileInput.files?.[0];
                  if (!file) return resolve(null);
                  try {
                    const url = await uploadGalleryImage(file);
                    resolve(url);
                  } catch (err) {
                    toastError(
                      err instanceof Error ? err.message : t("gallery.upload_failed", "העלאת התמונה נכשלה"),
                    );
                    resolve(null);
                  }
                };
                fileInput.click();
              });
            }}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="submit"
          disabled={busy || uploading > 0 || !slugFormatOk || slugStatus === "taken" || slugStatus === "checking"}
        >
          {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </Button>
      </form>
    </Card>
  );
}
