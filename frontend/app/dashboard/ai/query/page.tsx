"use client";

import { useState } from "react";

import { aiQuery, type AiQueryResponse } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";

/**
 * Natural-language -> data grid. Single-shot (no conversation history): one
 * prompt in, one table out. The backend never runs raw SQL — it validates the
 * model's intent against an explicit allowlist (see backend/app/crm_manifest.py)
 * and returns already-scoped rows; this page only renders them.
 */
export default function AiQueryPage() {
  const { t, lang } = useLocalization();
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AiQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);

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
        <p className="mt-1 text-sm text-gray-600">
          {t(
            "ai_query.intro",
            "כתבו בקשה בשפה חופשית וקבלו טבלה — למשל \"אנשי קשר בברוקלין עם סטטוס פייבליין X\".",
          )}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4">
        {!result && !loading && (
          <p className="py-10 text-center text-sm text-gray-400">
            {t("ai_query.empty", "עדיין אין תוצאות. כתבו בקשה כדי להתחיל.")}
          </p>
        )}
        {loading && (
          <p className="py-10 text-center text-sm text-gray-400">
            {t("ai_query.loading", "מריץ שאילתה…")}
          </p>
        )}
        {!loading && result && (
          <div>
            <h2 className="mb-2 text-lg font-semibold">{result.table_title}</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-right text-gray-600">
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
                        className="px-4 py-6 text-center text-gray-400"
                      >
                        {t("ai_query.no_rows", "לא נמצאו תוצאות")}
                      </td>
                    </tr>
                  ) : (
                    result.rows.map((row, i) => (
                      <tr key={i} className={i % 2 === 1 ? "bg-gray-50/50" : undefined}>
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
              <p className="mt-2 text-xs text-gray-400">
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
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("ai_query.placeholder", "מה תרצה לעשות?")}
          disabled={loading}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="rounded-md bg-status-magenta px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-status-magenta/90 disabled:opacity-50"
        >
          {t("ai_query.send", "שלח")}
        </button>
      </form>
    </div>
  );
}
