"use client";

import { useEffect, useState, type FormEvent } from "react";

import { AddressAutocomplete, type PlaceResult } from "@/components/AddressAutocomplete";
import { BackupRestoreCard } from "@/components/BackupRestoreCard";
import { LogoUpload } from "@/components/LogoUpload";
import { MapPointPicker } from "@/components/MapPointPicker";
import { PublicPageSettingsCard } from "@/components/PublicPageSettingsCard";
import { apiFetch, changePassword } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { OrgDetails } from "@/lib/types";
import { isMediumPassword, PASSWORD_HINT } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// fixes40 §4: global field-label text styling options.
const LABEL_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24];
const LABEL_FONTS = [
  "Arial",
  "Inter",
  "Roboto",
  "Times New Roman",
  "Segoe UI",
  "Georgia",
  "Verdana",
];
const DEFAULT_LABEL_COLOR = "#374151";

export default function SettingsPage() {
  const { isAdmin, loading, refresh } = useAuth();
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [name, setName] = useState("");
  // fixes85: separate English title (blank = the Hebrew name is used).
  const [nameEn, setNameEn] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [mapInEnglish, setMapInEnglish] = useState(false);
  // fixes18 §6: shliach contacts-visibility permission (default off).
  const [shliachViewContacts, setShliachViewContacts] = useState(false);
  // fixes40 §4: global field-label text styling — "" means unset (app default).
  const [labelFontSize, setLabelFontSize] = useState<string>("");
  const [labelColor, setLabelColor] = useState<string>("");
  const [labelFontFamily, setLabelFontFamily] = useState<string>("");
  const [lat, setLat] = useState<string>("");
  const [lng, setLng] = useState<string>("");
  const [zoom, setZoom] = useState<string>("13");
  // fixes62 §3.1: free-text search feeding the map picker below — not a
  // persisted field, just the current text in the autocomplete input.
  const [regionSearch, setRegionSearch] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // fixes22 §1: block Save while the logo upload is still in flight, so we
  // never persist the old logo_url over a just-picked (not-yet-uploaded) one.
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    apiFetch<OrgDetails>("/api/organizations/me")
      .then((o) => {
        setName(o.name);
        setNameEn(o.name_en ?? "");
        setLogoUrl(o.logo_url);
        setMapInEnglish(o.map_in_english);
        setShliachViewContacts(o.shliach_can_view_contacts ?? false);
        setLabelFontSize(o.label_font_size?.toString() ?? "");
        setLabelColor(o.label_color ?? "");
        setLabelFontFamily(o.label_font_family ?? "");
        setLat(o.default_lat?.toString() ?? "");
        setLng(o.default_lng?.toString() ?? "");
        setZoom(o.default_zoom?.toString() ?? "13");
      })
      .catch(() => {});
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiFetch<OrgDetails>("/api/organizations/me", {
        method: "PUT",
        body: JSON.stringify({
          name,
          name_en: nameEn.trim() || null,
          logo_url: logoUrl,
          map_in_english: mapInEnglish,
          shliach_can_view_contacts: shliachViewContacts,
          label_font_size: labelFontSize === "" ? null : Number(labelFontSize),
          label_color: labelColor === "" ? null : labelColor,
          label_font_family: labelFontFamily === "" ? null : labelFontFamily,
          default_lat: lat === "" ? null : Number(lat),
          default_lng: lng === "" ? null : Number(lng),
          default_zoom: zoom === "" ? 13 : Number(zoom),
        }),
      });
      await refresh(); // update header/title
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה");
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-lg">
      <h1 className="text-2xl font-bold">{t("nav.settings", "הגדרות")}</h1>

      {isAdmin && (
      <Card className="p-0">
      <form onSubmit={save} className="p-6 space-y-4">
        <label className="block space-y-1">
          <Label className="block text-sm font-medium">{t("signup.org_name", "שם הארגון")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <Label className="block text-sm font-medium">
            {t("settings.org_name_en", "שם הארגון באנגלית")}
          </Label>
          <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          <span className="block text-xs text-muted-foreground">
            {t("settings.org_name_en_hint", "מוצג כשהמערכת או דף הארגון מוצגים באנגלית. ריק = השם בעברית.")}
          </span>
        </label>

        <div className="space-y-1">
          <span className="block text-sm font-medium">{t("signup.org_logo", "לוגו הארגון")}</span>
          <LogoUpload
            value={logoUrl}
            onChange={setLogoUrl}
            onUploadingChange={setLogoUploading}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mapInEnglish}
            onChange={(e) => setMapInEnglish(e.target.checked)}
          />
          {t("page.map_in_english", "השלמת כתובות במפה באנגלית")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("page.map_in_english_hint", "כאשר מסומן, הצעות הכתובת מ-Google יוחזרו באנגלית במקום בעברית.")}
        </p>

        {/* fixes18 §6: shliach contacts-visibility permission (default off). */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={shliachViewContacts}
            onChange={(e) => setShliachViewContacts(e.target.checked)}
          />
          {t("page.shliach_view_contacts", "פעילים רשאים לצפות באנשי קשר")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t(
            "page.shliach_view_contacts_hint",
            "כאשר כבוי (ברירת המחדל), משתמשי פעיל אינם רואים את רשימת אנשי הקשר.",
          )}
        </p>

        {/* fixes40 §4: global field-label text styling — applies across the
            system; each property is independent and optional. */}
        <div className="border-t border-border pt-4 space-y-3">
          <span className="block text-sm font-medium">
            {t("page.label_styling", "עיצוב טקסט תוויות שדות")}
          </span>
          <p className="text-xs text-muted-foreground">
            {t(
              "page.label_styling_hint",
              "משפיע על תוויות השדות בכל המערכת. השאירו ריק לשימוש בעיצוב ברירת המחדל.",
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">
                {t("page.label_font_size", "גודל גופן")}
              </span>
              <select
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                value={labelFontSize}
                onChange={(e) => setLabelFontSize(e.target.value)}
              >
                <option value="">{t("page.label_default", "ברירת מחדל")}</option>
                {LABEL_FONT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">
                {t("page.label_color", "צבע")}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-12 rounded-md border border-input p-0.5"
                  value={labelColor || DEFAULT_LABEL_COLOR}
                  onChange={(e) => setLabelColor(e.target.value)}
                />
                {labelColor && (
                  <button
                    type="button"
                    onClick={() => setLabelColor("")}
                    className="text-xs text-primary hover:underline"
                  >
                    {t("page.label_reset", "איפוס")}
                  </button>
                )}
              </div>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">
                {t("page.label_font_family", "גופן")}
              </span>
              <select
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                value={labelFontFamily}
                onChange={(e) => setLabelFontFamily(e.target.value)}
              >
                <option value="">{t("page.label_default", "ברירת מחדל")}</option>
                {LABEL_FONTS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <span className="block text-sm font-medium">
            {t("page.map_default_center", "מרכז ברירת מחדל למפה")}
          </span>
          <p className="text-xs text-muted-foreground">
            {t("page.map_center_hint", "נקודת ההתחלה של מפת האזורים (קו רוחב, קו אורך, מרחק תצוגה).")}
          </p>
          <AddressAutocomplete
            value={regionSearch}
            onChange={setRegionSearch}
            onPlace={(place: PlaceResult) => {
              if (place.lat == null || place.lng == null) return;
              setLat(place.lat.toFixed(6));
              setLng(place.lng.toFixed(6));
              setRegionSearch(place.address);
            }}
            className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <MapPointPicker
            lat={lat === "" ? null : Number(lat)}
            lng={lng === "" ? null : Number(lng)}
            zoom={zoom === "" ? 13 : Number(zoom)}
            onChange={(newLat, newLng) => {
              setLat(newLat.toFixed(6));
              setLng(newLng.toFixed(6));
            }}
            onZoomChange={(z) => setZoom(String(z))}
          />
          <div className="grid grid-cols-3 gap-2">
            <Input
              dir="ltr"
              placeholder={t("contacts.latitude", "קו רוחב")}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
            <Input
              dir="ltr"
              placeholder={t("contacts.longitude", "קו אורך")}
              value={lng}
              onChange={(e) => setLng(e.target.value)}
            />
            <Input
              type="number"
              dir="ltr"
              placeholder="zoom"
              value={zoom}
              onChange={(e) => setZoom(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || logoUploading}>
            {busy
              ? t("action.saving", "שומר…")
              : logoUploading
                ? t("logo.uploading", "מעלה לוגו…")
                : t("action.save", "שמור")}
          </Button>
          {saved && <span className="text-sm text-success">{t("action.saved", "נשמר ✓")}</span>}
        </div>
      </form>
      </Card>
      )}

      {/* fixes65 §1: branded public page + self-registration (admin-only). */}
      {isAdmin && <PublicPageSettingsCard />}

      {/* fixes16: backup & restore points (admin-only). */}
      {isAdmin && <BackupRestoreCard />}

      <ChangePasswordCard />
    </div>
  );
}

function ChangePasswordCard() {
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!isMediumPassword(next)) {
      setError(t("validation.password_hint", PASSWORD_HINT));
      return;
    }
    if (next !== confirm) {
      setError(t("signup.passwords_no_match", "הסיסמאות אינן תואמות"));
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      success(t("settings.password_changed", "הסיסמה עודכנה"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("settings.password_change_failed", "עדכון הסיסמה נכשל");
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-0">
    <form onSubmit={submit} className="p-6 space-y-4">
      <h2 className="text-lg font-semibold">{t("settings.change_password", "שינוי סיסמה")}</h2>
      <label className="block space-y-1">
        <Label className="block text-sm font-medium">{t("settings.current_password", "סיסמה נוכחית")}</Label>
        <Input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <label className="block space-y-1">
        <Label className="block text-sm font-medium">{t("settings.new_password", "סיסמה חדשה")}</Label>
        <Input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <label className="block space-y-1">
        <Label className="block text-sm font-medium">{t("signup.verify_password", "אימות סיסמה")}</Label>
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <p className="text-xs text-muted-foreground">{t("validation.password_hint", PASSWORD_HINT)}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? t("action.saving", "שומר…") : t("settings.change_password", "שינוי סיסמה")}
      </Button>
    </form>
    </Card>
  );
}
