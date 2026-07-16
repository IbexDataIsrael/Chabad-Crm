"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePicklist } from "@/lib/picklists";
import { useToast } from "@/lib/toast";
import {
  MIVTZOIM_FLAGS,
  type ContactCustomField,
  type MivtzoimFlag,
  type Visit,
  type VisitInteraction,
} from "@/lib/types";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { DatePicker } from "./DatePicker";
import { PicklistSelect } from "./PicklistSelect";
import { InteractionsFields } from "./VisitForm";
import { InlineEdit } from "./ui/InlineEdit";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/**
 * A visit's full detail card (fixes26 §2). `readOnly` renders every field as
 * plain text; otherwise the fields edit in place with per-field autosave —
 * `onPatch` persists a partial update and refreshes the `visit` prop upstream.
 * Creation still goes through `VisitForm`.
 */
export function VisitDetails({
  visit,
  readOnly = false,
  onPatch,
  onClose,
}: {
  visit: Visit;
  readOnly?: boolean;
  onPatch?: (partial: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const { error: toastError } = useToast();
  // fixes27 §4: admins can hide individual visit fields (visits.* toggles).
  const { isFieldVisible: vis } = useFieldSettings();
  const visitType = usePicklist("visit.type");
  const torah = usePicklist("checklist.torah_thought");
  const editable = !readOnly && onPatch != null;
  const visibleFlags = MIVTZOIM_FLAGS.filter((f) => vis(`visits.${f}`));
  const showTorah = vis("visits.torah_thought");
  const showRebbe = vis("visits.connection_to_rebbe");

  const [busyFlag, setBusyFlag] = useState<MivtzoimFlag | null>(null);

  // Custom-field values (stored per visit, fixes25).
  const [customFields, setCustomFields] = useState<ContactCustomField[]>([]);
  const customRef = useRef(customFields);
  customRef.current = customFields;
  const customDirty = useRef(false);
  useEffect(() => {
    let active = true;
    apiFetch<ContactCustomField[]>(`/api/visits/${visit.id}/custom-fields`)
      .then((values) => active && setCustomFields(values))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [visit.id]);

  async function persistCustomFields(items: ContactCustomField[]) {
    if (!customDirty.current) return;
    customDirty.current = false;
    try {
      await apiFetch(`/api/visits/${visit.id}/custom-fields`, {
        method: "PUT",
        body: JSON.stringify(
          items.map((c) => ({
            definition_id: c.definition_id,
            checked: c.checked,
            note: c.note,
          })),
        ),
      });
    } catch (err) {
      customDirty.current = true;
      toastError(
        err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"),
      );
    }
  }

  function handleCustomChange(next: ContactCustomField[]) {
    // A checkbox flip is a definitive action — save at once; note typing
    // saves when focus leaves the section.
    const checkedFlipped = next.some(
      (it, i) => it.checked !== customFields[i]?.checked,
    );
    setCustomFields(next);
    customDirty.current = true;
    if (checkedFlipped) void persistCustomFields(next);
  }

  async function toggleFlag(flag: MivtzoimFlag) {
    if (!editable || busyFlag) return;
    setBusyFlag(flag);
    try {
      await onPatch!({ [flag]: !visit[flag] });
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"),
      );
    } finally {
      setBusyFlag(null);
    }
  }

  async function saveInteractions(items: VisitInteraction[]) {
    try {
      await onPatch!({ interactions: items });
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"),
      );
    }
  }

  /** Inline single-line/textarea editor for a plain visit text column. */
  function inlineText(
    field: "location" | "notes" | "connection_to_rebbe",
    multiline = false,
  ): ReactNode {
    const value = visit[field];
    const displayNode = value ? (
      <span className="whitespace-pre-wrap">{value}</span>
    ) : (
      "—"
    );
    if (!editable) return displayNode;
    return (
      <InlineEdit<string>
        value={value ?? ""}
        display={displayNode}
        enterCommits={!multiline}
        onSave={(v) => onPatch!({ [field]: v.trim() === "" ? null : v.trim() })}
        editor={(draft, setDraft) =>
          multiline ? (
            <textarea
              className={inputClass}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <input
              className={inputClass}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          )
        }
      />
    );
  }

  const dateNode = editable ? (
    <InlineEdit<string | null>
      value={visit.visit_date}
      display={
        <span dir="ltr">{new Date(visit.visit_date).toLocaleDateString("he-IL")}</span>
      }
      validate={(v) => (v ? null : t("visit.pick_date", "יש לבחור תאריך"))}
      onSave={(v) => onPatch!({ visit_date: v })}
      editor={(draft, setDraft) => (
        <DatePicker value={draft} onChange={setDraft} className={inputClass} />
      )}
    />
  ) : (
    <span dir="ltr">{new Date(visit.visit_date).toLocaleDateString("he-IL")}</span>
  );

  const typeNode = editable ? (
    <InlineEdit<string | null>
      value={visit.visit_type}
      display={visitType.labelFor(visit.visit_type) || "—"}
      commitOnBlur={false}
      onSave={(v) => onPatch!({ visit_type: v })}
      editor={(draft, _setDraft, commit) => (
        <PicklistSelect fieldKey="visit.type" value={draft} onChange={commit} />
      )}
    />
  ) : (
    visitType.labelFor(visit.visit_type) || "—"
  );

  const torahNode = editable ? (
    <InlineEdit<string | null>
      value={visit.torah_thought}
      display={torah.labelFor(visit.torah_thought) || "—"}
      commitOnBlur={false}
      onSave={(v) => onPatch!({ torah_thought: v })}
      editor={(draft, _setDraft, commit) => (
        <PicklistSelect
          fieldKey="checklist.torah_thought"
          value={draft}
          onChange={commit}
        />
      )}
    />
  ) : (
    torah.labelFor(visit.torah_thought) || "—"
  );

  return (
    <div className="rounded-md border border-gray-200 p-3 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 flex-1">
          {visit.contact_name && (
            <div className="flex flex-col">
              <dt className="text-xs text-gray-500">{t("visit.contact", "איש קשר")}</dt>
              <dd className="text-sm">{visit.contact_name}</dd>
            </div>
          )}
          <div className="flex flex-col">
            <dt className="text-xs text-gray-500">{t("visit.date", "תאריך")}</dt>
            <dd className="text-sm">{dateNode}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-gray-500">{t("visit.type", "סוג ביקור")}</dt>
            <dd className="text-sm">{typeNode}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-gray-500">{t("visit.location", "מיקום")}</dt>
            <dd className="text-sm">{inlineText("location")}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-gray-500">{t("visit.notes", "הערות")}</dt>
            <dd className="text-sm">{inlineText("notes")}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-500 hover:underline shrink-0"
        >
          {t("action.close", "סגור")}
        </button>
      </div>

      {/* fixes25 §4: Mivtzoim flags logged on the visit. fixes27 §2/§4: the
          custom fields live inside this section (no separate heading), and
          every field honors its admin visibility toggle. */}
      {(visibleFlags.length > 0 || showTorah || showRebbe || customFields.length > 0) && (
        <section className="space-y-2 border-t border-gray-100 pt-3">
          <h4 className="text-sm font-semibold">{t("visits.mivtzoim", "מבצעים")}</h4>
          {visibleFlags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {visibleFlags.map((flag) => (
                <button
                  key={flag}
                  type="button"
                  onClick={() => toggleFlag(flag)}
                  disabled={!editable || busyFlag === flag}
                  className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ${
                    visit[flag]
                      ? "border-status-green bg-status-green/10 text-status-green"
                      : "border-gray-200 text-gray-600"
                  } ${editable ? "hover:bg-gray-50" : "cursor-default"} ${
                    busyFlag === flag ? "opacity-60" : ""
                  }`}
                >
                  <span>{t(`visits.${flag}`)}</span>
                  <span>{visit[flag] ? "✓" : ""}</span>
                </button>
              ))}
            </div>
          )}
          {(showTorah || showRebbe) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {showTorah && (
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500">
                    {t("visits.torah_thought", "דבר תורה")}
                  </span>
                  <span className="text-sm">{torahNode}</span>
                </div>
              )}
              {showRebbe && (
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500">
                    {t("visits.connection_to_rebbe", "קשר לרבי")}
                  </span>
                  <span className="text-sm">{inlineText("connection_to_rebbe", true)}</span>
                </div>
              )}
            </div>
          )}
          {customFields.length > 0 && (
            <div
              onBlur={(e) => {
                if (!editable) return;
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                void persistCustomFields(customRef.current);
              }}
            >
              {editable ? (
                <CustomFieldsEditor items={customFields} onChange={handleCustomChange} />
              ) : (
                <ul className="space-y-1.5">
                  {customFields.map((it) => (
                    <li key={it.definition_id} className="flex items-center gap-2 text-sm">
                      <span>{it.checked ? "✓" : "—"}</span>
                      <span>{it.hebrew_label}</span>
                      {it.note && <span className="text-gray-500">— {it.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {/* fixes25 §4: the interaction log lives on the visit. */}
      <InteractionsFields
        value={visit.interactions}
        onChange={(items) => void saveInteractions(items)}
        readOnly={!editable}
      />
    </div>
  );
}
