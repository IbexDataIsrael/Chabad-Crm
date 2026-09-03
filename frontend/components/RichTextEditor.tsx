"use client";

import { Image as ImageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useLocalization } from "@/lib/localization";

/**
 * Dependency-free WYSIWYG editor for the superadmin email templates
 * (fixes15 §2.1): a contentEditable surface with a small formatting toolbar,
 * plus an HTML-source mode for hand-editing the full markup. Values that are
 * complete HTML documents (like the seeded welcome mail) open in HTML mode —
 * the visual surface keeps only body content.
 */
export function RichTextEditor({
  value,
  onChange,
  dir = "ltr",
  imagePicker,
}: {
  value: string;
  onChange: (html: string) => void;
  dir?: "ltr" | "rtl";
  /** fixes56 §2: when provided, adds an image toolbar button that calls this
   *  to get a URL (resolving `null` cancels) and inserts it as an <img> at
   *  the caret. Opt-in per instance — the picker is org-scoped and specific
   *  to the announcement editor, not something every RichTextEditor caller
   *  (e.g. the email-template editor) should get for free. */
  imagePicker?: () => Promise<string | null>;
}) {
  const { t } = useLocalization();
  const [pickerBusy, setPickerBusy] = useState(false);
  const isFullDocument = /<html[\s>]|<!doctype/i.test(value);
  const [mode, setMode] = useState<"visual" | "html">(
    isFullDocument ? "html" : "visual",
  );
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Push external value into the editable DOM only when it actually differs —
  // rewriting innerHTML on every keystroke would reset the caret.
  useEffect(() => {
    if (mode !== "visual") return;
    const el = surfaceRef.current;
    if (el && el.innerHTML !== value) el.innerHTML = value;
  }, [value, mode]);

  function exec(cmd: string, arg?: string) {
    surfaceRef.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange(surfaceRef.current?.innerHTML ?? "");
  }

  function addLink() {
    const url = window.prompt(t("editor.link_prompt", "כתובת הקישור:"), "https://");
    if (url) exec("createLink", url);
  }

  async function openImagePicker() {
    if (!imagePicker || pickerBusy) return;
    setPickerBusy(true);
    try {
      const url = await imagePicker();
      if (url) exec("insertImage", url);
    } finally {
      setPickerBusy(false);
    }
  }

  const toolBtn =
    "rounded border border-border px-2 py-1 text-xs hover:bg-accent min-w-[1.9rem]";
  const modeBtn = (active: boolean) =>
    `rounded px-2 py-1 text-xs ${
      active
        ? "bg-primary text-primary-foreground"
        : "border border-border text-muted-foreground hover:bg-accent"
    }`;

  return (
    <div className="rounded-md border border-input overflow-hidden bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-background px-2 py-1.5">
        {mode === "visual" && (
          <>
            <button type="button" className={`${toolBtn} font-bold`} title={t("editor.bold", "מודגש")} onClick={() => exec("bold")}>
              B
            </button>
            <button type="button" className={`${toolBtn} italic`} title={t("editor.italic", "נטוי")} onClick={() => exec("italic")}>
              I
            </button>
            <button type="button" className={`${toolBtn} underline`} title={t("editor.underline", "קו תחתון")} onClick={() => exec("underline")}>
              U
            </button>
            <button type="button" className={toolBtn} title={t("editor.list", "רשימה")} onClick={() => exec("insertUnorderedList")}>
              ••
            </button>
            <button type="button" className={toolBtn} title={t("editor.list", "רשימה")} onClick={() => exec("insertOrderedList")}>
              1.
            </button>
            <button type="button" className={toolBtn} title={t("editor.link", "קישור")} onClick={addLink}>
              🔗
            </button>
            {imagePicker && (
              <button
                type="button"
                className={toolBtn}
                title={t("editor.image", "תמונה")}
                disabled={pickerBusy}
                onClick={openImagePicker}
              >
                <ImageIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
        <span className="ms-auto flex items-center gap-1">
          <button type="button" className={modeBtn(mode === "visual")} onClick={() => setMode("visual")}>
            {t("editor.visual", "עיצוב")}
          </button>
          <button type="button" className={modeBtn(mode === "html")} onClick={() => setMode("html")}>
            {t("editor.html", "HTML")}
          </button>
        </span>
      </div>
      {mode === "visual" ? (
        /* pre-wrap keeps the newlines of legacy plain-text templates visible */
        <div
          ref={surfaceRef}
          dir={dir}
          contentEditable
          suppressContentEditableWarning
          onInput={() => onChange(surfaceRef.current?.innerHTML ?? "")}
          className="min-h-[8rem] max-h-[24rem] overflow-y-auto px-3 py-2 text-sm whitespace-pre-wrap focus:outline-none"
        />
      ) : (
        <textarea
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-h-[12rem] max-h-[28rem] px-3 py-2 font-mono text-xs focus:outline-none resize-y"
          spellCheck={false}
        />
      )}
    </div>
  );
}
