"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/errorReport";

/** fixes101 §2c: last-resort boundary when the root layout itself crashes.
 *  It replaces the whole document, so no providers (localization, styles
 *  context) are available — plain bilingual text and inline styles. */
export default function GlobalError({ error }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, "react");
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "64px 16px", background: "hsl(230, 30%, 6%)", color: "hsl(220, 25%, 92%)" }}>
        <h1 style={{ fontSize: 20 }}>משהו השתבש / Something went wrong</h1>
        <p style={{ color: "hsl(222, 12%, 62%)", fontSize: 14 }}>
          התקלה נרשמה ונשלחה לצוות. / The error was logged and sent to the team.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: 16, minHeight: 44, padding: "0 20px", borderRadius: 8, border: "1px solid hsl(220, 14%, 25%)", background: "hsl(199, 89%, 55%)", color: "hsl(230, 40%, 7%)", fontWeight: 600 }}
        >
          טען מחדש / Reload
        </button>
      </body>
    </html>
  );
}
