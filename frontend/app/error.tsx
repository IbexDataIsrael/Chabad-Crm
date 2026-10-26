"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/errorReport";
import { useLocalization } from "@/lib/localization";

/** fixes101 §2c: a React render error anywhere below the root layout —
 *  reported to the error log, with a retry instead of a blank page. */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useLocalization();
  useEffect(() => {
    reportClientError(error, "react");
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <div className="glass-card flex w-full flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">{t("error_page.title", "משהו השתבש")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("error_page.body", "התקלה נרשמה ונשלחה לצוות. אפשר לנסות שוב.")}
        </p>
        <div className="flex gap-2">
          <Button onClick={reset} className="min-h-[44px]">
            {t("error_page.retry", "נסה שוב")}
          </Button>
          <Button variant="outline" className="min-h-[44px]" onClick={() => window.location.reload()}>
            {t("error_page.reload", "טען מחדש את הדף")}
          </Button>
        </div>
      </div>
    </div>
  );
}
