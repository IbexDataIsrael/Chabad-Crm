"use client";

import { useLocalization } from "@/lib/localization";
import { CHECKLIST_ROWS, type Checklist } from "@/lib/types";
import { PicklistSelect } from "./PicklistSelect";

/** Controlled checklist editor: 5 boolean+note rows + the torah_thought picklist. */
export function ChecklistFields({
  value,
  onChange,
}: {
  value: Checklist;
  onChange: (value: Checklist) => void;
}) {
  const { t } = useLocalization();

  function setField<K extends keyof Checklist>(key: K, v: Checklist[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className="space-y-3">
      {CHECKLIST_ROWS.map(({ bool, note }) => {
        const checked = value[bool] as boolean;
        return (
          <div key={bool} className="flex flex-col sm:flex-row sm:items-center gap-2">
            <button
              type="button"
              onClick={() => setField(bool, !checked as Checklist[typeof bool])}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm sm:w-48 ${
                checked
                  ? "border-status-green bg-status-green/10 text-status-green"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <span>{t(`community_checklists.${bool}`)}</span>
              <span>{checked ? "✓" : ""}</span>
            </button>
            <input
              className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
              placeholder={t("field.note_placeholder", "הערה…")}
              value={(value[note] as string | null) ?? ""}
              onChange={(e) =>
                setField(note, (e.target.value || null) as Checklist[typeof note])
              }
            />
          </div>
        );
      })}

      <label className="block space-y-1 max-w-xs">
        <span className="block text-sm font-medium">
          {t("community_checklists.torah_thought", "דבר תורה")}
        </span>
        <PicklistSelect
          fieldKey="checklist.torah_thought"
          value={value.torah_thought}
          onChange={(v) => setField("torah_thought", v)}
        />
      </label>
    </div>
  );
}
