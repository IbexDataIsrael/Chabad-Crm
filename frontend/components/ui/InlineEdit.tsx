"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";

/**
 * Google-style inline editing wrapper (fixes26 §2): renders a static value;
 * clicking it swaps in an editor. Clicking away (focus leaving the wrapper)
 * or pressing Enter saves; Escape reverts. Editors whose change *is* the
 * final intent (native selects, pickers) call `commit(next)` directly and
 * usually pass `commitOnBlur={false}` so clicking away cancels instead.
 */
export function InlineEdit<T>({
  value,
  display,
  editor,
  onSave,
  validate,
  disabled = false,
  commitOnBlur = true,
  enterCommits = true,
  onOpen,
}: {
  value: T;
  display: ReactNode;
  /** Renders the active editor; `commit(v)` saves immediately (pickers). */
  editor: (draft: T, setDraft: (v: T) => void, commit: (v: T) => void) => ReactNode;
  onSave: (value: T) => Promise<void>;
  /** Returns an error message (blocks the save) or null. */
  validate?: (value: T) => string | null;
  disabled?: boolean;
  /** false for editors where clicking away should cancel, not save. */
  commitOnBlur?: boolean;
  /** false for textareas — Enter makes a newline (Ctrl+Enter still saves). */
  enterCommits?: boolean;
  /** Fires the first time this editor opens — for an editor whose option
   *  list is expensive to fetch, load it here instead of on page mount. */
  onOpen?: () => void;
}) {
  const { t } = useLocalization();
  const { error: toastError } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(value);
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Blur commits must read the freshest draft (state updates lag the event).
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!editing) return;
    const el = boxRef.current?.querySelector<HTMLElement>("input, textarea, select");
    el?.focus();
    if (el instanceof HTMLInputElement && !el.readOnly) el.select();
    if (el instanceof HTMLTextAreaElement) el.select();
  }, [editing]);

  function open() {
    if (disabled || editing) return;
    setDraft(value);
    setEditing(true);
    onOpen?.();
  }

  async function commit(next?: T) {
    if (saving) return;
    const v = next === undefined ? draftRef.current : next;
    if (JSON.stringify(v) === JSON.stringify(value)) {
      setEditing(false);
      return;
    }
    // fixes29 §2: no toast — the live inline hint under the editor already
    // explains the problem; just refuse to save and stay in edit.
    if (validate?.(v)) return;
    setSaving(true);
    try {
      await onSave(v);
      setEditing(false);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"),
      );
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      setEditing(false);
    } else if (e.key === "Enter" && (enterCommits || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  }

  if (!editing) {
    if (disabled) return <>{display}</>;
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter") open();
        }}
        title={t("inline.click_to_edit", "לחץ לעריכה")}
        className="group inline-flex max-w-full items-baseline gap-1 rounded px-1 -mx-1 cursor-pointer hover:bg-gray-100"
      >
        <span className="min-w-0">{display}</span>
        <span
          aria-hidden
          className="text-xs text-gray-300 opacity-0 group-hover:opacity-100"
        >
          ✎
        </span>
      </span>
    );
  }

  // fixes29 §2: validate the live draft so the error renders directly under
  // the input while typing — same placement and styling as the add form's
  // EmailInput/PhoneInput hints — instead of a toast on save.
  const problem = validate ? validate(draft) : null;

  return (
    <div
      ref={boxRef}
      className={`space-y-1 ${saving ? "opacity-60 pointer-events-none" : ""}`}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!commitOnBlur || saving) return;
        // Focus moving within the editor (dropdowns, calendar buttons) is
        // not a click-away.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        void commit();
      }}
    >
      {editor(draft, setDraft, (v) => void commit(v))}
      {problem && (
        <span className="block text-xs text-status-darkred">{problem}</span>
      )}
    </div>
  );
}
