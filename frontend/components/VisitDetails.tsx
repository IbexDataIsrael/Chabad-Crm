"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePicklist, usePicklistsMap } from "@/lib/picklists";
import { useToast } from "@/lib/toast";
import {
  type ContactCustomField,
  type Visit,
  type VisitInteraction,
} from "@/lib/types";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { CustomFieldValueDisplay, CustomFieldValueInput } from "./CustomFieldValueInput";
import { DatePicker } from "./DatePicker";
import { PicklistSelect } from "./PicklistSelect";
import { InteractionsFields } from "./VisitForm";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { InlineEdit } from "./ui/InlineEdit";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

// fixes50 §2.1: same label pill as ContactView.tsx — this card renders
// inline on the contact page's "visits" segment, so it should match.
// Background/text color are inline styles (see ContactView.tsx's dtStyle
// comment) — a production report showed the Tailwind bg-muted/
// text-muted-foreground classes only taking effect on hover.
const dtClass = "inline-block w-fit rounded px-1.5 py-0.5 text-xs font-medium";
const dtStyle: CSSProperties = { backgroundColor: "#f4f4f5", color: "#71717a" };

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
  const showTorah = vis("visits.torah_thought");
  // fixes50 §1.1: location + visit type join torah_thought as hideable.
  const showLocation = vis("visits.location");
  const showVisitType = vis("visits.visit_type");

  // fixes35: any non-boolean, non-select visit custom field (boolean stays
  // exclusively on the legacy CustomFieldsEditor checkbox+note path below),
  // plus any visit-scoped select custom picklist.
  const visitCustomFieldDefs = useCustomFieldDefs("visit").filter(
    (d) => d.field_type !== "select" && d.field_type !== "boolean",
  );
  const visitPicklistDefs = useCustomFieldDefs("visit").filter((d) => d.field_type === "select");
  const visitPicklists = usePicklistsMap(
    visitPicklistDefs.map((d) => `checklist.${d.field_key}`),
  );

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
    field: "location" | "notes",
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
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} />
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
    <div className="rounded-md border border-border p-3 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 flex-1">
          {visit.contact_name && (
            <div className="flex flex-col">
              <dt className={dtClass} style={dtStyle}>{t("visit.contact", "איש קשר")}</dt>
              <dd className="text-sm">{visit.contact_name}</dd>
            </div>
          )}
          <div className="flex flex-col">
            <dt className={dtClass} style={dtStyle}>{t("visit.date", "תאריך")}</dt>
            <dd className="text-sm">{dateNode}</dd>
          </div>
          {showVisitType && (
            <div className="flex flex-col">
              <dt className={dtClass} style={dtStyle}>{t("visit.type", "סוג ביקור")}</dt>
              <dd className="text-sm">{typeNode}</dd>
            </div>
          )}
          {showLocation && (
            <div className="flex flex-col">
              <dt className={dtClass} style={dtStyle}>{t("visit.location", "מיקום")}</dt>
              <dd className="text-sm">{inlineText("location")}</dd>
            </div>
          )}
          <div className="flex flex-col">
            <dt className={dtClass} style={dtStyle}>{t("visit.notes", "הערות")}</dt>
            <dd className="text-sm">{inlineText("notes")}</dd>
          </div>
        </dl>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="shrink-0">
          {t("action.close", "סגור")}
        </Button>
      </div>

      {/* fixes25 §4: Mivtzoim flags logged on the visit. fixes27 §2/§4: the
          custom fields live inside this section (no separate heading), and
          every field honors its admin visibility toggle. fixes39: the
          boolean flags render via `customFields` below (legacy
          checkbox+note sub-resource) and connection_to_rebbe via
          `visitCustomFieldDefs` below (field_type="text") — neither has
          dedicated markup here anymore. */}
      {(showTorah ||
        customFields.length > 0 ||
        visitCustomFieldDefs.length > 0 ||
        visitPicklistDefs.length > 0) && (
        <section className="space-y-2 border-t border-border pt-3">
          <h4 className="text-sm font-semibold">{t("visits.mivtzoim", "מבצעים")}</h4>
          {showTorah && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col">
                <span className={dtClass} style={dtStyle}>
                  {t("visits.torah_thought", "דבר תורה")}
                </span>
                <span className="text-sm">{torahNode}</span>
              </div>
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
                      {it.note && <span className="text-muted-foreground">— {it.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {(visitPicklistDefs.length > 0 || visitCustomFieldDefs.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* fixes35 §5: any visit-scoped select custom field. */}
              {visitPicklistDefs.map((d) => {
                const key = `checklist.${d.field_key}`;
                const value = visit.picklist_values?.[d.field_key] ?? null;
                return (
                  <div key={d.field_key} className="flex flex-col">
                    <span className={dtClass} style={dtStyle}>{d.hebrew_label}</span>
                    <span className="text-sm">
                      {editable ? (
                        <InlineEdit<string | null>
                          value={value}
                          display={visitPicklists.labelFor(key, value) || "—"}
                          commitOnBlur={false}
                          onSave={(v) => onPatch!({ picklist_values: { [d.field_key]: v } })}
                          editor={(draft, _setDraft, commit) => (
                            <PicklistSelect fieldKey={key} value={draft} onChange={commit} />
                          )}
                        />
                      ) : (
                        visitPicklists.labelFor(key, value) || "—"
                      )}
                    </span>
                  </div>
                );
              })}
              {/* fixes35: any non-boolean, non-select visit custom field. */}
              {visitCustomFieldDefs.map((d) => {
                const value = visit.custom_field_values?.[d.field_key] ?? null;
                return (
                  <div key={d.field_key} className="flex flex-col">
                    <span className={dtClass} style={dtStyle}>{d.hebrew_label}</span>
                    <span className="text-sm">
                      {editable ? (
                        <InlineEdit<string | number | boolean | null>
                          value={value}
                          display={
                            <CustomFieldValueDisplay fieldType={d.field_type} value={value} />
                          }
                          commitOnBlur={d.field_type === "text" || d.field_type === "number"}
                          onSave={(v) =>
                            onPatch!({ custom_field_values: { [d.field_key]: v } })
                          }
                          editor={(draft, setDraft, commit) => (
                            <CustomFieldValueInput
                              fieldType={d.field_type}
                              value={draft}
                              onChange={d.field_type === "date" ? commit : setDraft}
                            />
                          )}
                        />
                      ) : (
                        <CustomFieldValueDisplay fieldType={d.field_type} value={value} />
                      )}
                    </span>
                  </div>
                );
              })}
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
