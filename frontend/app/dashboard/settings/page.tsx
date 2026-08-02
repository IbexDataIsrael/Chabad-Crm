"use client";

import { useEffect, useState, type FormEvent } from "react";

import { BackupRestoreCard } from "@/components/BackupRestoreCard";
import { LogoUpload } from "@/components/LogoUpload";
import { MapPointPicker } from "@/components/MapPointPicker";
import { apiFetch, changePassword } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { OrgDetails } from "@/lib/types";
import { isMediumPassword, PASSWORD_HINT } from "@/lib/validation";

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

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  return (
    <div className="space-y-5 max-w-lg">
      <h1 className="text-2xl font-bold">{t("nav.settings", "הגדרות")}</h1>

      {isAdmin && (
      <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("signup.org_name", "שם הארגון")}</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
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
        <p className="text-xs text-gray-400">
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
        <p className="text-xs text-gray-400">
          {t(
            "page.shliach_view_contacts_hint",
            "כאשר כבוי (ברירת המחדל), משתמשי פעיל אינם רואים את רשימת אנשי הקשר.",
          )}
        </p>

        {/* fixes40 §4: global field-label text styling — applies across the
            system; each property is independent and optional. */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <span className="block text-sm font-medium">
            {t("page.label_styling", "עיצוב טקסט תוויות שדות")}
          </span>
          <p className="text-xs text-gray-400">
            {t(
              "page.label_styling_hint",
              "משפיע על תוויות השדות בכל המערכת. השאירו ריק לשימוש בעיצוב ברירת המחדל.",
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-gray-500">
                {t("page.label_font_size", "גודל גופן")}
              </span>
              <select
                className={inputClass}
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
              <span className="block text-xs text-gray-500">
                {t("page.label_color", "צבע")}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-12 rounded-md border border-gray-300 p-0.5"
                  value={labelColor || DEFAULT_LABEL_COLOR}
                  onChange={(e) => setLabelColor(e.target.value)}
                />
                {labelColor && (
                  <button
                    type="button"
                    onClick={() => setLabelColor("")}
                    className="text-xs text-status-magenta hover:underline"
                  >
                    {t("page.label_reset", "איפוס")}
                  </button>
                )}
              </div>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-gray-500">
                {t("page.label_font_family", "גופן")}
              </span>
              <select
                className={inputClass}
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

        <div className="border-t border-gray-100 pt-4 space-y-2">
          <span className="block text-sm font-medium">
            {t("page.map_default_center", "מרכז ברירת מחדל למפה")}
          </span>
          <p className="text-xs text-gray-400">
            {t("page.map_center_hint", "נקודת ההתחלה של מפת האזורים (קו רוחב, קו אורך, מרחק תצוגה).")}
          </p>
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
            <input
              className={inputClass}
              dir="ltr"
              placeholder={t("contacts.latitude", "קו רוחב")}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
            <input
              className={inputClass}
              dir="ltr"
              placeholder={t("contacts.longitude", "קו אורך")}
              value={lng}
              onChange={(e) => setLng(e.target.value)}
            />
            <input
              type="number"
              className={inputClass}
              dir="ltr"
              placeholder="zoom"
              value={zoom}
              onChange={(e) => setZoom(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-status-darkred">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || logoUploading}
            className="rounded-md bg-status-magenta text-white px-5 py-2 font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? t("action.saving", "שומר…")
              : logoUploading
                ? t("logo.uploading", "מעלה לוגו…")
                : t("action.save", "שמור")}
          </button>
          {saved && <span className="text-sm text-status-green">{t("action.saved", "נשמר ✓")}</span>}
        </div>
      </form>
      )}

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

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

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
    <form onSubmit={submit} className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <h2 className="text-lg font-semibold">{t("settings.change_password", "שינוי סיסמה")}</h2>
      <label className="block space-y-1">
        <span className="block text-sm font-medium">{t("settings.current_password", "סיסמה נוכחית")}</span>
        <input
          type="password"
          className={inputClass}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <label className="block space-y-1">
        <span className="block text-sm font-medium">{t("settings.new_password", "סיסמה חדשה")}</span>
        <input
          type="password"
          className={inputClass}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <label className="block space-y-1">
        <span className="block text-sm font-medium">{t("signup.verify_password", "אימות סיסמה")}</span>
        <input
          type="password"
          className={inputClass}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <p className="text-xs text-gray-400">{t("validation.password_hint", PASSWORD_HINT)}</p>
      {error && <p className="text-sm text-status-darkred">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-status-magenta text-white px-5 py-2 font-medium hover:opacity-90 disabled:opacity-50"
      >
        {busy ? t("action.saving", "שומר…") : t("settings.change_password", "שינוי סיסמה")}
      </button>
    </form>
  );
}
