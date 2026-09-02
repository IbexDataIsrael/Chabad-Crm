"use client";

import { Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { aiQuery, type AiQueryResponse } from "@/lib/api";
import { isFeatureEnabled, useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Natural-language -> data grid. Single-shot (no conversation history): one
 * prompt in, one table out. The backend never runs raw SQL — it validates the
 * model's intent against an explicit allowlist (see backend/app/crm_manifest.py)
 * and returns already-scoped rows; this page only renders them.
 */
export default function AiQueryPage() {
  const { t, lang } = useLocalization();
  const toast = useToast();
  const router = useRouter();
  // fixes54 §7: the sidebar link is already hidden for the Activist role
  // (dashboard/layout.tsx), but that alone doesn't stop a direct URL visit —
  // the backend itself also rejects a shliach's request (routers/ai_query.py),
  // this redirect just keeps a shliach from ever seeing the page render.
  const { user: me, isShliach, loading: authLoading } = useAuth();
  // fixes54 §8: the superadmin-managed org-wide AI toggle — same redirect,
  // the backend rejects the request either way.
  const aiDisabledForOrg = !isFeatureEnabled(me?.organization, "ai_query_enabled");
  useEffect(() => {
    if (authLoading || (!isShliach && !aiDisabledForOrg)) return;
    router.replace(me?.shliach?.contact_id ? "/dashboard/activist" : "/dashboard");
  }, [authLoading, isShliach, aiDisabledForOrg, me, router]);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AiQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  if (authLoading || isShliach || aiDisabledForOrg) return null;

  async function send() {
    const value = prompt.trim();
    if (!value || loading) return;
    setLoading(true);
    try {
      const response = await aiQuery(value);
      setResult(response);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai_query.error", "השאילתה נכשלה — נסה שוב"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-5xl flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{t("ai_query.title", "שאילתת AI")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "ai_query.intro",
            "כתבו בקשה בשפה חופשית וקבלו טבלה — למשל \"אנשי קשר בברוקלין עם סטטוס פייבליין X\".",
          )}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4">
        {!result && !loading && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("ai_query.empty", "עדיין אין תוצאות. כתבו בקשה כדי להתחיל.")}
          </p>
        )}
        {loading && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("ai_query.loading", "מריץ שאילתה…")}
          </p>
        )}
        {!loading && result && (
          <div>
            <h2 className="text-lg font-semibold">{result.table_title}</h2>
            <p className="mb-2 text-sm text-muted-foreground">
              {result.row_count} {t("ai_query.results", "תוצאות")}
            </p>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-background text-right text-muted-foreground">
                  <tr>
                    {result.columns.map((col) => (
                      <th key={col.key} className="w-px whitespace-nowrap px-3 py-1.5 font-medium">
                        {lang === "en" ? col.label_en : col.label_he}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={result.columns.length}
                        className="px-4 py-6 text-center text-muted-foreground"
                      >
                        {t("ai_query.no_rows", "לא נמצאו תוצאות")}
                      </td>
                    </tr>
                  ) : (
                    result.rows.map((row, i) => (
                      <tr key={i} className={i % 2 === 1 ? "bg-background/50" : undefined}>
                        {result.columns.map((col) => (
                          <td key={col.key} className="whitespace-nowrap px-3 py-1.5">
                            {row[col.key] === null || row[col.key] === undefined
                              ? ""
                              : String(row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {result.truncated && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("ai_query.truncated", "מוצגות 200 התוצאות הראשונות בלבד")}
              </p>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="mt-3 flex gap-2"
      >
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("ai_query.placeholder", "מה תרצה לעשות?")}
          disabled={loading}
          className="flex-1"
        />
        <Button type="submit" disabled={loading || !prompt.trim()}>
          <Send className="h-4 w-4" /> {t("ai_query.send", "שלח")}
        </Button>
      </form>
    </div>
  );
}
