"use client";

import { useEffect, useState } from "react";

import { CustomFieldValueDisplay, CustomFieldValueInput } from "@/components/CustomFieldValueInput";
import { PicklistSelect } from "@/components/PicklistSelect";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { TruncatedText } from "@/components/ui/TruncatedText";
import { apiFetch } from "@/lib/api";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePicklistsMap } from "@/lib/picklists";
import { useTaskSheetFields } from "@/lib/taskSheetFields";
import type { CustomFieldDefinition, PicklistField, Task } from "@/lib/types";

/** fixes104 §2: one admin-added task field — a task picklist (made on the
 *  Picklists page's Tasks tab, or a select-type custom field) or a non-select
 *  custom field. `key` is `pl:<field_key>` / `cf:<field_key>`, the id used by
 *  grid columns, filters and the print settings alike. */
export type TaskCustomField =
  | { kind: "pl"; key: string; fieldKey: string; label: string; def: PicklistField }
  | { kind: "cf"; key: string; fieldKey: string; label: string; def: CustomFieldDefinition };

/** `task.custom_date` is the built-in "custom date" column, not an add-on. */
const BUILTIN_TASK_PICKLISTS = ["task.custom_date"];

/** The org's task fields (org-hidden ones excluded), plus option lists for
 *  the picklist ones. */
export function useTaskCustomFields() {
  const { lang } = useLocalization();
  const { isFieldVisible, loading: settingsLoading } = useFieldSettings();
  const [picklistDefs, setPicklistDefs] = useState<PicklistField[] | null>(null);
  const fieldDefs = useCustomFieldDefs("task");

  useEffect(() => {
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) =>
        setPicklistDefs(
          defs.filter((d) => d.entity_type === "task" && !BUILTIN_TASK_PICKLISTS.includes(d.field_key)),
        ),
      )
      .catch(() => setPicklistDefs([]));
  }, []);

  const fields: TaskCustomField[] = [
    ...(picklistDefs ?? [])
      .filter((d) => isFieldVisible(d.field_key))
      .map(
        (d): TaskCustomField => ({
          kind: "pl",
          key: `pl:${d.field_key}`,
          fieldKey: d.field_key,
          label: (lang === "en" ? d.english_label || d.label : d.label) || d.field_key,
          def: d,
        }),
      ),
    ...fieldDefs
      .filter((d) => d.is_active && d.field_type !== "select")
      .filter((d) => isFieldVisible(`customfield.task.${d.field_key}`))
      .map(
        (d): TaskCustomField => ({
          kind: "cf",
          key: `cf:${d.field_key}`,
          fieldKey: d.field_key,
          label: (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) || d.field_key,
          def: d,
        }),
      ),
  ];
  const picklists = usePicklistsMap(fields.filter((f) => f.kind === "pl").map((f) => f.fieldKey));

  /** The value as display text (picklist label, ✓ for a checked box). */
  function textFor(task: Task, f: TaskCustomField): string {
    if (f.kind === "pl") return picklists.labelFor(f.fieldKey, task.picklist_values?.[f.fieldKey] ?? null);
    const v = task.custom_field_values?.[f.fieldKey];
    if (v == null || v === "") return "";
    if (typeof v === "boolean") return v ? "✓" : "";
    return String(v);
  }

  return { fields, picklists, textFor, ready: picklistDefs !== null && !settingsLoading };
}

/** fixes104 §2: the chosen task fields as the print sheet's [label, value]
 *  lines (blank values print as "—" so the office can fill them in). */
export function useTaskSheetFacts(): (task: Task) => [string, string][] {
  const { t } = useLocalization();
  const { fields, textFor } = useTaskCustomFields();
  const [config] = useTaskSheetFields();
  // A checkbox prints as words — the PDF's Hebrew font has no ✓ glyph.
  const printText = (task: Task, f: TaskCustomField) =>
    f.kind === "cf" && f.def.field_type === "boolean"
      ? task.custom_field_values?.[f.fieldKey]
        ? t("filter.yes", "כן")
        : t("filter.no", "לא")
      : textFor(task, f) || "—";
  return (task) =>
    fields
      .filter((f) => config.taskFields == null || config.taskFields.includes(f.key))
      .map((f) => [f.label, printText(task, f)]);
}

/** An inline-editable cell/value for one task field (saves through
 *  PUT /api/tasks/{id}). */
export function TaskCustomFieldEditor({
  task,
  field,
  labelFor,
  onSave,
}: {
  task: Task;
  field: TaskCustomField;
  labelFor: (fieldKey: string, value: string | null | undefined) => string;
  onSave: (data: Partial<Task>) => Promise<void>;
}) {
  if (field.kind === "pl") {
    return (
      <InlineEdit<string | null>
        value={task.picklist_values?.[field.fieldKey] ?? null}
        display={<TruncatedText text={labelFor(field.fieldKey, task.picklist_values?.[field.fieldKey]) || "—"} />}
        commitOnBlur={false}
        onSave={(v) => onSave({ picklist_values: { [field.fieldKey]: v } })}
        editor={(draft, _setDraft, commit) => (
          <PicklistSelect fieldKey={field.fieldKey} value={draft} onChange={commit} />
        )}
      />
    );
  }
  const fieldType = field.def.field_type;
  const value = task.custom_field_values?.[field.fieldKey] ?? null;
  return (
    <InlineEdit<string | number | boolean | null>
      value={value}
      display={
        fieldType === "text" && typeof value === "string" ? (
          <TruncatedText text={value} />
        ) : (
          <CustomFieldValueDisplay fieldType={fieldType} value={value} />
        )
      }
      commitOnBlur={fieldType === "text" || fieldType === "number"}
      onSave={(v) => onSave({ custom_field_values: { [field.fieldKey]: v } })}
      editor={(draft, setDraft, commit) => (
        <CustomFieldValueInput
          fieldType={fieldType}
          value={draft}
          onChange={fieldType === "boolean" || fieldType === "date" ? commit : setDraft}
        />
      )}
    />
  );
}
