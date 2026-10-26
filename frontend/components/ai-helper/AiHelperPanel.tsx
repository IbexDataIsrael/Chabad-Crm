"use client";

import { Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocalization } from "@/lib/localization";
import {
  sendChatMessage,
  type AssistantPassage,
  type AssistantResponse,
  type AssistantStatus,
} from "./chatAdapter";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  status: AssistantStatus | "error" | "loading";
  response?: AssistantResponse;
}

let nextId = 1;

function AssistantBody({ message }: { message: ChatMessage }) {
  const { t } = useLocalization();

  if (message.status === "loading") {
    return (
      <div className="flex items-center gap-1 py-1" aria-label={t("ai_helper.loading", "ממתין לתשובה…")}>
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
      </div>
    );
  }
  if (message.status === "error") {
    return (
      <p className="text-sm text-destructive">
        {t("ai_helper.error", "הבקשה נכשלה — נסו שוב בעוד רגע.")}
      </p>
    );
  }
  if (message.status === "not_connected") {
    return (
      <p className="text-sm text-muted-foreground">
        {t(
          "ai_helper.not_connected",
          "העוזר עדיין לא מחובר לשרת — התכונה תהיה זמינה בקרוב.",
        )}
      </p>
    );
  }
  if (message.status === "insufficient_sources") {
    return (
      <p className="text-sm text-muted-foreground">
        {t(
          "ai_helper.insufficient",
          "אין מספיק מידע במקורות הזמינים כדי לענות על שאלה זו.",
        )}
      </p>
    );
  }
  // "answer" and future "clarify" both render the reply text when there is one.
  return (
    <div>
      {message.response?.reply && <p className="text-sm">{message.response.reply}</p>}
      {message.status === "clarify" && !message.response?.reply && (
        <p className="text-sm text-muted-foreground">
          {t("ai_helper.clarify", "צריך הבהרה כדי לענות — נסחו את השאלה מחדש.")}
        </p>
      )}
      {message.response?.passages && message.response.passages.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {t("ai_helper.sources", "מקורות")}
          </p>
          <ul className="space-y-1">
            {message.response.passages.map((p: AssistantPassage, i: number) => (
              <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{p.heading}</span>
                  <span className="text-muted-foreground"> · {p.filename}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {Math.round(p.score * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const DEV_HINTS = ["error", "insufficient", "clarify", "nosources"];

export function AiHelperPanel({ onClose }: { onClose: () => void }) {
  const { t, dir } = useLocalization();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    const userMsg: ChatMessage = { id: nextId++, role: "user", text, status: "answer" };
    const assistantMsg: ChatMessage = {
      id: nextId++,
      role: "assistant",
      text: "",
      status: "loading",
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setDraft("");
    setSending(true);
    try {
      const response = await sendChatMessage(text);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, status: response.status, response } : m)),
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, status: "error" } : m)),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      dir={dir}
      className="fixed bottom-20 end-4 z-50 flex h-[500px] max-h-[calc(100dvh-6rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-popover/85 text-popover-foreground shadow-2xl shadow-black/50 backdrop-blur-xl"
      role="dialog"
      aria-label={t("ai_helper.title", "העוזר החכם")}
    >
      <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-b from-primary/95 to-primary px-4 py-3 text-primary-foreground shadow-glow">
        <h2 className="text-sm font-semibold">{t("ai_helper.title", "העוזר החכם")}</h2>
        <button
          onClick={onClose}
          aria-label={t("ai_helper.close", "סגירה")}
          className="rounded-md p-1 hover:bg-primary-foreground/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("ai_helper.empty", "שאלו שאלה כדי להתחיל.")}
          </p>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg rounded-br-none bg-primary px-3 py-2 text-sm text-primary-foreground">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[85%] rounded-xl rounded-bl-none border border-white/10 bg-white/5 px-3 py-2">
                <AssistantBody message={m} />
              </div>
            </div>
          ),
        )}
      </div>

      {process.env.NODE_ENV === "development" && (
        <p className="border-t border-white/10 px-4 py-1.5 text-[11px] text-muted-foreground">
          {t("ai_helper.dev_hint", "מוק בפיתוח — נסו:")} {DEV_HINTS.join(", ")}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex gap-2 border-t border-white/10 p-3"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("ai_helper.placeholder", "כתבו שאלה…")}
          disabled={sending}
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={sending || !draft.trim()}>
          <Send className="h-4 w-4" />
          <span className="sr-only">{t("ai_helper.send", "שליחה")}</span>
        </Button>
      </form>
    </div>
  );
}
