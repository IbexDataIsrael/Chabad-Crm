"use client";

import { useEffect, useRef, useState } from "react";

import { aiChat, type AiChatMessage } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";

/**
 * "Digital twin" AI chat — answers questions about the operator's career.
 * The conversation lives in component state (resets on reload); each send
 * posts the full history to /api/ai/chat (OpenRouter behind the backend).
 */
export default function AiChatPage() {
  const { t } = useLocalization();
  const toast = useToast();
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    const history: AiChatMessage[] = [...messages, { role: "user", content }];
    setMessages(history);
    setInput("");
    setSending(true);
    try {
      const { reply } = await aiChat(history);
      setMessages([...history, { role: "assistant", content: reply }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai.error", "השיחה נכשלה — נסה שוב"));
      // Roll the failed question back into the input so it isn't lost.
      setMessages(messages);
      setInput(content);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">🤖 {t("ai.title", "תאום דיגיטלי")}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {t("ai.intro", "שאל את התאום הדיגיטלי שאלות על הקריירה שלי.")}
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4">
        {messages.length === 0 && !sending && (
          <p className="py-10 text-center text-sm text-gray-400">
            {t("ai.empty", "עדיין אין הודעות. שאל שאלה כדי להתחיל.")}
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                m.role === "user"
                  ? "bg-status-magenta/10 text-gray-900"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-gray-100 px-4 py-2 text-sm text-gray-500">
              {t("ai.thinking", "חושב…")}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("ai.placeholder", "כתוב שאלה…")}
          disabled={sending}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-md bg-status-magenta px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-status-magenta/90 disabled:opacity-50"
        >
          {t("ai.send", "שלח")}
        </button>
      </form>
    </div>
  );
}
