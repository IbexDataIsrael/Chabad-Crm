"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/errorReport";

/** fixes101 §2c: report uncaught browser errors and unhandled promise
 *  rejections. React render errors are reported by app/error.tsx. */
export function ClientErrorReporter() {
  useEffect(() => {
    function onError(ev: ErrorEvent) {
      // A failed <img>/<script> load also fires "error", without an Error.
      if (!ev.error && !ev.message) return;
      reportClientError(ev.error ?? new Error(ev.message), "error");
    }
    function onRejection(ev: PromiseRejectionEvent) {
      reportClientError(ev.reason, "unhandledrejection");
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
