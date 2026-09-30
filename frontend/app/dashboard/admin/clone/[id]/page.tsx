"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Copy, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import {
  adminCloneOrg,
  adminListOrganizations,
  type AdminOrgCreate,
  type AdminOrganization,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

/** fixes84: cloning an org used to be a modal taller than the screen with no
 *  way to scroll to its button. It's a page now — labeled fields, normal page
 *  scrolling (mobile too), and a visible in-progress state, since a clone of
 *  a large org can take a minute. */

const CLONE_LIMIT_TABLES: { table: string; labelKey: string; fallback: string }[] = [
  { table: "apartments", labelKey: "nav.apartments", fallback: "דירות" },
  { table: "contacts", labelKey: "nav.contacts", fallback: "אנשי קשר" },
  { table: "visit_history", labelKey: "admin.clone_org_limit_visits", fallback: "ביקורים" },
  { table: "donations", labelKey: "nav.donations", fallback: "תרומות" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export default function CloneOrgPage() {
  const params = useParams<{ id: string }>();
  const orgId = Number(params.id);
  const router = useRouter();
  const { isSuperadmin, loading } = useAuth();
  const { t } = useLocalization();


  const [org, setOrg] = useState<AdminOrganization | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState<AdminOrgCreate>({
    organization_name: "",
    admin_full_name: "",
    admin_email: "",
    admin_username: "sample_admin",
    admin_password: "",
  });
  const [limitInputs, setLimitInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || !isSuperadmin) return;
    adminListOrganizations()
      .then((orgs) => {
        const found = orgs.find((o) => o.id === orgId) ?? null;
        if (!found) {
          setNotFound(true);
          return;
        }
        setOrg(found);
        // Only a default: this effect can re-run (auth state refresh) after
        // the superadmin already typed a name — never overwrite it.
        setForm((f) =>
          f.organization_name ? f : { ...f, organization_name: `${found.name} - Sample` },
        );
      })
      .catch(() => setNotFound(true));
  }, [loading, isSuperadmin, orgId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const table_row_limits: Record<string, number> = {};
    for (const { table } of CLONE_LIMIT_TABLES) {
      const raw = limitInputs[table]?.trim();
      if (!raw) continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) table_row_limits[table] = Math.floor(n);
    }
    setBusy(true);
    try {
      const created = await adminCloneOrg(
        orgId,
        Object.keys(table_row_limits).length > 0 ? { ...form, table_row_limits } : form,
      );
      // The org list spotlights the new org (it's appended at the bottom of
      // a long list — without this, a successful clone looked like nothing).
      router.push(`/dashboard/admin?cloned=${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !isSuperadmin) {
    return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  }
  if (notFound) {
    return <p className="text-muted-foreground">{t("admin.approve_link_missing", "הארגון לא נמצא.")}</p>;
  }
  if (!org) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <Link
        href="/dashboard/admin"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowRight className="h-4 w-4" /> {t("admin.back_to_orgs", "חזרה לארגונים")}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{t("admin.clone_org_title", "שכפול ארגון")}</h1>
        <p className="mt-1 text-sm">
          {t("admin.clone_org_source", "ארגון מקור:")}{" "}
          <span className="font-semibold">{org.name}</span>{" "}
          <span className="text-muted-foreground" dir="ltr" style={{ unicodeBidi: "isolate" }}>
            #{org.id}
          </span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "admin.clone_org_intro",
            "יוצר ארגון חדש עם עותק מלא של כל הנתונים — אנשי קשר, ביקורים, דירות, בניינים, רשימות בחירה ועוד. הארגון המקורי לא ישתנה.",
          )}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Card className="p-4 space-y-3">
          <h2 className="font-semibold">{t("admin.clone_org_new_org", "הארגון החדש והמנהל שלו")}</h2>
          <Field label={t("signup.org_name", "שם הארגון")}>
            <Input
              required
              value={form.organization_name}
              onChange={(e) => setForm({ ...form, organization_name: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("admin.admin_name", "שם המנהל")}>
              <Input
                required
                value={form.admin_full_name}
                onChange={(e) => setForm({ ...form, admin_full_name: e.target.value })}
              />
            </Field>
            <Field label={t("contacts.email", "אימייל")}>
              <Input
                required
                dir="ltr"
                type="email"
                value={form.admin_email}
                onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
              />
            </Field>
            <Field label={t("auth.username", "שם משתמש")}>
              <Input
                required
                dir="ltr"
                value={form.admin_username}
                onChange={(e) => setForm({ ...form, admin_username: e.target.value })}
              />
            </Field>
            <Field label={t("auth.password", "סיסמה")}>
              <Input
                required
                dir="ltr"
                type="text"
                value={form.admin_password}
                onChange={(e) => setForm({ ...form, admin_password: e.target.value })}
              />
            </Field>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div>
            <h2 className="font-semibold">
              {t("admin.clone_org_limits_title", "הגבלת מספר רשומות (אופציונלי)")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t(
                "admin.clone_org_limits_hint",
                "השאירו ריק כדי לשכפל את כל הרשומות בטבלה. רשומה שמתייחסת לרשומה שלא שוכפלה (כי הוגבלה בטבלה אחרת) תושמט.",
              )}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {CLONE_LIMIT_TABLES.map(({ table, labelKey, fallback }) => (
              <Field key={table} label={t(labelKey, fallback)}>
                {table === "apartments" && (
                  <span className="block text-xs text-muted-foreground">
                    {t(
                      "admin.clone_org_apartments_hint",
                      "משוכפלים בניינים שלמים עד שמגיעים למספר הזה (מעוגל כלפי מעלה). רק האזורים ומספרי הדוח של הבניינים האלה משוכפלים.",
                    )}
                  </span>
                )}
                <Input
                  type="number"
                  min={0}
                  dir="ltr"
                  value={limitInputs[table] ?? ""}
                  onChange={(e) => setLimitInputs({ ...limitInputs, [table]: e.target.value })}
                  placeholder="∞"
                />
              </Field>
            ))}
          </div>
        </Card>

        {error && (
          <p role="alert" className="rounded-md bg-status-darkred/10 p-3 text-sm text-status-darkred" dir="auto">
            {error}
          </p>
        )}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("admin.clone_org_running", "משכפל… בארגון גדול זה יכול לקחת דקה או יותר. אין לסגור את הדף.")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            {t("admin.clone_org_confirm", "שכפל ארגון")}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => router.push("/dashboard/admin")}>
            {t("action.cancel", "ביטול")}
          </Button>
        </div>
      </form>
    </div>
  );
}
