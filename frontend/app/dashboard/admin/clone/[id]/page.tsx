"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Copy, Loader2, Users } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import {
  adminCloneOrg,
  adminClonePlan,
  adminListOrganizations,
  type AdminOrgCreate,
  type AdminOrganization,
  type ClonePlan,
  type CloneResult,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

/** fixes84: cloning an org has its own page (the modal didn't fit the
 *  screen). fixes87: a DEMO clone — the superadmin asks for N activists and a
 *  target number of apartments; the system picks the activists (with tasks)
 *  whose task apartments come closest, shows that as a preview, and clones
 *  only after approval: those activists (with made-up demo logins), their
 *  tasks + campaigns, and exactly their task apartments. */

// Caps on the rest of the data (contacts other than the chosen activists,
// visits, donations). Apartments are decided by the activists' tasks.
const CLONE_LIMIT_TABLES: { table: string; labelKey: string; fallback: string }[] = [
  { table: "contacts", labelKey: "nav.contacts", fallback: "אנשי קשר" },
  { table: "visit_history", labelKey: "admin.clone_org_limit_visits", fallback: "ביקורים" },
  { table: "donations", labelKey: "nav.donations", fallback: "תרומות" },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

type Step = "form" | "preview" | "done";

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
  const [activistCount, setActivistCount] = useState("5");
  const [apartmentTarget, setApartmentTarget] = useState("200");
  const [demoPassword, setDemoPassword] = useState("");
  const [limitInputs, setLimitInputs] = useState<Record<string, string>>({});
  const [step, setStep] = useState<Step>("form");
  const [plan, setPlan] = useState<ClonePlan | null>(null);
  const [result, setResult] = useState<CloneResult | null>(null);
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

  const errText = (err: unknown) =>
    err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה");

  // Step 1 → 2 (and "recalculate" on the preview): the system's pick.
  async function calculate(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    const n = Math.floor(Number(activistCount));
    const target = Math.floor(Number(apartmentTarget));
    if (!(n >= 1) || !(target >= 0)) {
      setError(t("admin.clone_demo_numbers_invalid", "יש להזין מספר פעילים (לפחות 1) ומספר דירות."));
      return;
    }
    if (!demoPassword.trim()) {
      setError(t("admin.clone_demo_password_required", "יש להזין סיסמה לכניסות הדמו של הפעילים."));
      return;
    }
    setBusy(true);
    try {
      const p = await adminClonePlan(orgId, n, target);
      setPlan(p);
      setStep("preview");
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  // Step 2 → 3: approved — clone exactly the previewed activists.
  async function approve() {
    if (!plan) return;
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
      const created = await adminCloneOrg(orgId, {
        ...form,
        ...(Object.keys(table_row_limits).length > 0 ? { table_row_limits } : {}),
        demo_activist_user_ids: plan.activists.map((a) => a.user_id),
        demo_password: demoPassword,
      });
      setResult(created);
      setStep("done");
    } catch (err) {
      setError(errText(err));
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

  const numbersFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("admin.clone_demo_activists", "מספר פעילים")}>
        <Input
          type="number"
          min={1}
          dir="ltr"
          required
          value={activistCount}
          onChange={(e) => setActivistCount(e.target.value)}
        />
      </Field>
      <Field label={t("admin.clone_demo_apartments", "מספר דירות (יעד)")}>
        <Input
          type="number"
          min={0}
          dir="ltr"
          required
          value={apartmentTarget}
          onChange={(e) => setApartmentTarget(e.target.value)}
        />
      </Field>
    </div>
  );

  return (
    <div className="max-w-2xl space-y-4">
      <Link
        href="/dashboard/admin"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowRight className="h-4 w-4" /> {t("admin.back_to_orgs", "חזרה לארגונים")}
      </Link>
      <div>
        <h1 className="font-display text-3xl font-bold">{t("admin.clone_org_title", "שכפול ארגון")}</h1>
        <p className="mt-1 text-sm">
          {t("admin.clone_org_source", "ארגון מקור:")}{" "}
          <span className="font-semibold">{org.name}</span>{" "}
          <span className="text-muted-foreground" dir="ltr" style={{ unicodeBidi: "isolate" }}>
            #{org.id}
          </span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "admin.clone_demo_intro",
            "שכפול לצורכי הדגמה: המערכת בוחרת פעילים שיש להם משימות, ומשכפלת אותם עם המשימות שלהם והדירות שבמשימות. לפני השכפול תוצג תצוגה מקדימה לאישור.",
          )}
        </p>
      </div>

      {step === "form" && (
        <form onSubmit={calculate} className="space-y-4">
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
            <h2 className="font-semibold">{t("admin.clone_demo_title", "פעילים ודירות")}</h2>
            {numbersFields}
            <Field
              label={t("admin.clone_demo_password", "סיסמה לכניסות הדמו של הפעילים")}
              hint={t(
                "admin.clone_demo_password_hint",
                "כל פעיל משוכפל מקבל כניסת דמו (activist1@org…demo) עם הסיסמה הזו — הפעילים האמיתיים לא יראו את ארגון הדמו.",
              )}
            >
              <Input
                required
                dir="ltr"
                type="text"
                value={demoPassword}
                onChange={(e) => setDemoPassword(e.target.value)}
              />
            </Field>
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-semibold">
                {t("admin.clone_org_limits_title", "הגבלת מספר רשומות (אופציונלי)")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t(
                  "admin.clone_demo_limits_hint",
                  "השאירו ריק כדי לשכפל הכול. הפעילים שנבחרו משוכפלים תמיד, גם מעבר להגבלת אנשי הקשר.",
                )}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {CLONE_LIMIT_TABLES.map(({ table, labelKey, fallback }) => (
                <Field key={table} label={t(labelKey, fallback)}>
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

          {error && <ErrorBox text={error} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("admin.clone_demo_calculate", "המשך — חישוב")}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => router.push("/dashboard/admin")}>
              {t("action.cancel", "ביטול")}
            </Button>
          </div>
        </form>
      )}

      {step === "preview" && plan && (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            {plan.activists.length === 0 ? (
              <p className="text-sm font-medium text-destructive">
                {t("admin.clone_demo_none", "אין בארגון המקור פעילים עם משימות — אין מה לשכפל במצב הדגמה.")}
              </p>
            ) : (
              <>
                <p className="text-lg font-bold">
                  {t("admin.clone_demo_summary", "המערכת תשכפל {n} פעילים ו-{apts} דירות")
                    .replace("{n}", String(plan.activists.length))
                    .replace("{apts}", String(plan.apartment_count))}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("admin.clone_demo_summary_detail", "ב-{b} בניינים. יעד שביקשת: {target} דירות.")
                    .replace("{b}", String(plan.building_count))
                    .replace("{target}", apartmentTarget)}
                </p>
                {Number(activistCount) > plan.activists.length && (
                  <p className="text-sm text-status-orange">
                    {t("admin.clone_demo_fewer", "ביקשת {asked} פעילים, אך רק ל-{have} פעילים יש משימות.")
                      .replace("{asked}", activistCount)
                      .replace("{have}", String(plan.available_activists))}
                  </p>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-1.5 pe-3 text-start font-medium">{t("admin.clone_demo_col_activist", "פעיל")}</th>
                      <th className="py-1.5 pe-3 text-start font-medium">{t("admin.clone_demo_col_tasks", "משימות")}</th>
                      <th className="py-1.5 text-start font-medium">{t("admin.clone_demo_col_apartments", "דירות במשימות")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.activists.map((a) => (
                      <tr key={a.user_id} className="border-b border-border last:border-0">
                        <td className="py-1.5 pe-3">
                          <Users className="me-1 inline h-3.5 w-3.5 text-muted-foreground" />
                          {a.full_name}
                        </td>
                        <td className="py-1.5 pe-3">{a.task_count}</td>
                        <td className="py-1.5">{a.apartment_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>

          {/* The superadmin can ask for a different mix before approving. */}
          <Card className="p-4 space-y-3">
            <h2 className="font-semibold">{t("admin.clone_demo_adjust", "לשנות ולחשב מחדש")}</h2>
            <form onSubmit={calculate} className="space-y-3">
              {numbersFields}
              <Button type="submit" variant="outline" disabled={busy}>
                {t("admin.clone_demo_recalculate", "חשב מחדש")}
              </Button>
            </form>
          </Card>

          {error && <ErrorBox text={error} />}
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("admin.clone_org_running", "משכפל… בארגון גדול זה יכול לקחת דקה או יותר. אין לסגור את הדף.")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={approve} disabled={busy || plan.activists.length === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              {t("admin.clone_demo_approve", "אישור — שכפל")}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setStep("form")}>
              {t("action.cancel", "ביטול")}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <Card className="p-4 space-y-3">
          <p className="flex items-center gap-2 text-lg font-bold text-status-green">
            <CheckCircle2 className="h-5 w-5" />
            {t("admin.clone_demo_done", "{apts} דירות שוכפלו! {n} פעילים, {tasks} משימות.")
              .replace("{apts}", String(result.clone_apartments))
              .replace("{n}", String(result.clone_activists))
              .replace("{tasks}", String(result.clone_tasks))}
          </p>
          <p className="text-sm">
            {t("admin.clone_demo_new_org", "הארגון החדש:")} <span className="font-semibold">{result.name}</span>{" "}
            <span className="text-muted-foreground" dir="ltr" style={{ unicodeBidi: "isolate" }}>
              #{result.id}
            </span>
          </p>
          {result.demo_logins.length > 0 && (
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="mb-1 font-medium">
                {t("admin.clone_demo_logins", "כניסות הדמו של הפעילים (הסיסמה שהוזנה):")}
              </p>
              <ul className="space-y-0.5">
                {result.demo_logins.map((l) => (
                  <li key={l.username}>
                    {l.full_name} — <span dir="ltr" className="font-mono">{l.username}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button type="button" onClick={() => router.push(`/dashboard/admin?cloned=${result.id}`)}>
            {t("admin.back_to_orgs", "חזרה לארגונים")}
          </Button>
        </Card>
      )}
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" dir="auto">
      {text}
    </p>
  );
}
