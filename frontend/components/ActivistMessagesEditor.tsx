"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { ActivistMessage } from "@/lib/types";

/** The placeholders a message can use — filled on the activist's device. */
const PLACEHOLDERS = ["organization_name", "number_of_apartments", "number_of_jews"] as const;

const textareaClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring";

/** fixes98: shliach-config "messages for activists" — two lists (Hebrew,
 *  English). Messages are added/edited/deleted one at a time; the
 *  placeholder chips insert {name} at the caret. */
export function ActivistMessagesEditor() {
  const { t } = useLocalization();
  const [items, setItems] = useState<ActivistMessage[] | null>(null);

  function reload() {
    return apiFetch<ActivistMessage[]>("/api/activist-messages")
      .then(setItems)
      .catch(() => setItems([]));
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="bg-card rounded-xl shadow-sm p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">
          {t("activist_messages.title", "הודעות לפעילים")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "activist_messages.hint",
            "הודעות קצרות שמוצגות לפעילים בחגיגה אחרי כל 5 דירות, לסירוגין עם טקסט החגיגה הרגיל. הפעיל רואה את ההודעות בשפת המערכת שלו. אפשר לשלב בטקסט את השדות המחושבים — הם יוחלפו בערכים מ\"הגדרות ← נתונים לפעילים\".",
          )}
        </p>
      </div>
      {items === null ? (
        <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <MessageList
            language="he"
            title={t("activist_messages.hebrew", "עברית")}
            items={items.filter((m) => m.language === "he")}
            onChanged={reload}
          />
          <MessageList
            language="en"
            title={t("activist_messages.english", "אנגלית")}
            items={items.filter((m) => m.language === "en")}
            onChanged={reload}
          />
        </div>
      )}
    </div>
  );
}

function PlaceholderChips({ onInsert }: { onInsert: (token: string) => void }) {
  const { t } = useLocalization();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">
        {t("activist_messages.insert_field", "הוספת שדה:")}
      </span>
      {PLACEHOLDERS.map((name) => (
        <button
          key={name}
          type="button"
          dir="ltr"
          onMouseDown={(e) => e.preventDefault() /* keep the textarea's caret */}
          onClick={() => onInsert(`{${name}}`)}
          className="min-h-[32px] rounded-full border border-border bg-background px-2.5 text-xs hover:bg-muted"
        >
          {`{${name}}`}
        </button>
      ))}
    </div>
  );
}

/** Insert `token` at the textarea's caret (or at the end). */
function insertAt(
  el: HTMLTextAreaElement | null,
  value: string,
  token: string,
  setValue: (v: string) => void,
) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
  });
}

function MessageList({
  language,
  title,
  items,
  onChanged,
}: {
  language: "he" | "en";
  title: string;
  items: ActivistMessage[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const dir = language === "he" ? "rtl" : "ltr";

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await apiFetch("/api/activist-messages", {
        method: "POST",
        body: JSON.stringify({ text: draft.trim(), language }),
      });
      setDraft("");
      await onChanged();
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">
        {title} <span className="text-muted-foreground">({items.length})</span>
      </h3>
      <ul className="space-y-2">
        {items.length === 0 && (
          <li className="text-sm text-muted-foreground">
            {t("activist_messages.none", "אין הודעות עדיין.")}
          </li>
        )}
        {items.map((m) => (
          <MessageRow key={m.id} item={m} dir={dir} onChanged={onChanged} />
        ))}
      </ul>
      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <textarea
          ref={ref}
          dir={dir}
          rows={3}
          className={textareaClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("activist_messages.new_placeholder", "הודעה חדשה…")}
        />
        <PlaceholderChips onInsert={(tok) => insertAt(ref.current, draft, tok, setDraft)} />
        <Button type="button" size="sm" disabled={busy || !draft.trim()} onClick={() => void add()}>
          <Plus className="h-4 w-4" />
          {t("activist_messages.add", "הוספה לרשימה")}
        </Button>
      </div>
    </section>
  );
}

function MessageRow({
  item,
  dir,
  onChanged,
}: {
  item: ActivistMessage;
  dir: "rtl" | "ltr";
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const confirmDialog = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  async function save() {
    if (!draft.trim()) return;
    if (draft.trim() === item.text) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/activist-messages/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ text: draft.trim() }),
      });
      setEditing(false);
      await onChanged();
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !(await confirmDialog({
        message: t("activist_messages.delete_confirm", "למחוק את ההודעה?"),
        detail: item.text,
      }))
    ) {
      return;
    }
    try {
      await apiFetch(`/api/activist-messages/${item.id}`, { method: "DELETE" });
      await onChanged();
      success(t("msg.deleted", "נמחק בהצלחה"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  if (editing) {
    return (
      <li className="space-y-2 rounded-lg border border-primary/40 p-3">
        <textarea
          ref={ref}
          dir={dir}
          rows={3}
          className={textareaClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <PlaceholderChips onInsert={(tok) => insertAt(ref.current, draft, tok, setDraft)} />
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy || !draft.trim()} onClick={() => void save()}>
            {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(item.text);
              setEditing(false);
            }}
          >
            {t("action.cancel", "ביטול")}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 rounded-lg border border-border p-3">
      <button
        type="button"
        dir={dir}
        className="min-w-0 flex-1 whitespace-pre-wrap text-start text-sm hover:text-primary"
        title={t("action.edit", "ערוך")}
        onClick={() => setEditing(true)}
      >
        {item.text}
      </button>
      <button
        type="button"
        onClick={() => void remove()}
        className="shrink-0 rounded-md p-2 text-destructive hover:bg-destructive/10"
        aria-label={t("action.delete", "מחק")}
        title={t("action.delete", "מחק")}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
