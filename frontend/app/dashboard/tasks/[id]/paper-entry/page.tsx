"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { naturalCompare } from "@/lib/naturalSort";
import { usePicklist } from "@/lib/picklists";
import { useToast } from "@/lib/toast";
import {
  apartmentTitle,
  buildingDisplayName,
  type ApartmentListItem,
  type ApartmentPage,
  type PaperEntry,
  type PerformerType,
  type Task,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

type PaperField = "jewish_status" | "mezuzah_status" | "language" | "apartment_notes";

interface RowDraft {
  jewish_status: string | null;
  mezuzah_status: string | null;
  language: string[];
  apartment_notes: string;
}

interface ActivistOption {
  id: number;
  full_name: string;
  role: string;
  is_manual: boolean;
}

/** fixes65 §6: the office types in a handwritten task sheet. Mirrors the
 *  printed sheet's columns; only cells actually changed are sent. "Who
 *  performed the work?" is mandatory — a registered user, a free-text name
 *  (history only, no account created) or Unknown. */
export default function PaperEntryPage() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);
  const { isAdmin, isCampaignManager, loading } = useAuth();
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const jewish = usePicklist("apartment.Jewish_status");
  const mezuzah = usePicklist("apartment.mezuzah_status");
  const language = usePicklist("apartment.language");

  const [task, setTask] = useState<Task | null>(null);
  const [apartments, setApartments] = useState<ApartmentListItem[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
  const [touched, setTouched] = useState<Record<number, Set<PaperField>>>({});
  const [activists, setActivists] = useState<ActivistOption[]>([]);
  const [history, setHistory] = useState<PaperEntry[]>([]);
  const [performerType, setPerformerType] = useState<PerformerType | "">("");
  const [performerUserId, setPerformerUserId] = useState<number | "">("");
  const [performerName, setPerformerName] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadApartments(reportNumberIds: number[]) {
    if (reportNumberIds.length === 0) {
      setApartments([]);
      return;
    }
    const all: ApartmentListItem[] = [];
    for (let page = 1; ; page += 1) {
      const params = new URLSearchParams();
      reportNumberIds.forEach((rid) => params.append("report_number_ids", String(rid)));
      params.set("sort", "floor");
      params.set("dir", "asc");
      params.set("page", String(page));
      params.set("page_size", "100");
      const res = await apiFetch<ApartmentPage>(`/api/apartments/list?${params}`);
      all.push(...res.items);
      if (all.length >= res.total || res.items.length === 0) break;
    }
    all.sort(
      (a, b) =>
        naturalCompare(buildingDisplayName({ id: a.building_id, building_name: a.building_name, building_address: a.building_address }),
          buildingDisplayName({ id: b.building_id, building_name: b.building_name, building_address: b.building_address })) ||
        naturalCompare(a.floor ?? "", b.floor ?? "") ||
        naturalCompare(a.apartment_name ?? "", b.apartment_name ?? ""),
    );
    setApartments(all);
    setDrafts(
      Object.fromEntries(
        all.map((a) => [
          a.id,
          {
            jewish_status: a.jewish_status,
            mezuzah_status: a.mezuzah_status,
            language: a.language ?? [],
            apartment_notes: a.apartment_notes ?? "",
          },
        ]),
      ),
    );
    setTouched({});
  }

  async function loadAll() {
    const tk = await apiFetch<Task>(`/api/tasks/${taskId}`);
    setTask(tk);
    await loadApartments(tk.report_number_ids);
    setHistory(await apiFetch<PaperEntry[]>(`/api/tasks/${taskId}/paper-entries`));
  }

  useEffect(() => {
    if (loading || !Number.isFinite(taskId)) return;
    loadAll().catch(() => setApartments([]));
    apiFetch<ActivistOption[]>("/api/users")
      .then((rows) => setActivists(rows.filter((u) => u.role === "shliach")))
      .catch(() => setActivists([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, taskId]);

  function edit<K extends PaperField>(aptId: number, field: K, value: RowDraft[K]) {
    setDrafts((d) => ({ ...d, [aptId]: { ...d[aptId], [field]: value } }));
    setTouched((prev) => {
      const next = new Set(prev[aptId] ?? []);
      next.add(field);
      return { ...prev, [aptId]: next };
    });
  }

  const changedCount = useMemo(
    () => Object.values(touched).filter((s) => s.size > 0).length,
    [touched],
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!performerType) {
      setFormError(t("paper.performer_required", "יש לבחור מי ביצע את העבודה."));
      return;
    }
    if (performerType === "user" && performerUserId === "") {
      setFormError(t("paper.performer_user_required", "יש לבחור פעיל מהרשימה."));
      return;
    }
    if (performerType === "name" && !performerName.trim()) {
      setFormError(t("paper.performer_name_required", "יש להקליד את שם מבצע העבודה."));
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/tasks/${taskId}/paper-entries`, {
        method: "POST",
        body: JSON.stringify({
          performer_type: performerType,
          performer_user_id: performerType === "user" ? performerUserId : null,
          performer_name: performerType === "name" ? performerName.trim() : null,
          notes: notes.trim() || null,
          apartments: Object.entries(touched)
            .filter(([, fields]) => fields.size > 0)
            .map(([aptId, fields]) => {
              const d = drafts[Number(aptId)];
              return {
                apartment_id: Number(aptId),
                jewish_status: d.jewish_status,
                mezuzah_status: d.mezuzah_status,
                language: d.language,
                apartment_notes: d.apartment_notes.trim() || null,
                fields: [...fields],
              };
            }),
        }),
      });
      success(t("paper.saved", "נתוני הדף נשמרו"));
      setNotes("");
      await loadAll();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin && !isCampaignManager) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  const performerLabel = (entry: PaperEntry) =>
    entry.performer_type === "unknown"
      ? t("paper.performer_unknown", "לא ידוע")
      : entry.performer_name ?? "—";

  return (
    <form onSubmit={save} className="space-y-5">
      <Link
        href="/dashboard/tasks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowRight className="h-4 w-4" /> {t("paper.back_to_tasks", "חזרה למשימות")}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{t("paper.title", "הזנת נתונים מדף משימה מודפס")}</h1>
        {task && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t("task_pdf.title", "דף משימה")} #{task.id} — {task.campaign_name}
            {" | "}
            {task.report_number_names.join(", ") || "—"}
            {" | "}
            {task.volunteer_user_id
              ? task.volunteer_name
              : task.is_orphan
                ? t("task.orphan_badge", "לא משויך")
                : t("task.office_handled", "בטיפול המשרד")}
          </p>
        )}
      </div>

      {/* Mandatory attribution — first, so it can't be forgotten. */}
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">{t("paper.performer_title", "מי ביצע את העבודה?")}</h2>
        <div className="flex flex-wrap gap-4 text-sm" role="radiogroup">
          {(
            [
              ["user", t("paper.performer_user", "פעיל רשום")],
              ["name", t("paper.performer_name", "שם חופשי")],
              ["unknown", t("paper.performer_unknown", "לא ידוע")],
            ] as [PerformerType, string][]
          ).map(([value, label]) => (
            <label key={value} className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="performer"
                className="accent-primary"
                checked={performerType === value}
                onChange={() => setPerformerType(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {performerType === "user" && (
          <select
            className={`${inputClass} max-w-sm`}
            value={performerUserId}
            onChange={(e) => setPerformerUserId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">{t("task.select_activist", "בחר פעיל")}</option>
            {activists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
                {a.is_manual ? ` (${t("paper.no_login", "ללא התחברות")})` : ""}
              </option>
            ))}
          </select>
        )}
        {performerType === "name" && (
          <div className="max-w-sm space-y-1">
            <input
              className={inputClass}
              value={performerName}
              onChange={(e) => setPerformerName(e.target.value)}
              placeholder={t("paper.performer_name_ph", "לדוגמה: משה כהן")}
            />
            <p className="text-xs text-muted-foreground">
              {t("paper.performer_name_hint", "השם יישמר בהיסטוריה בלבד — לא ייפתח חשבון משתמש.")}
            </p>
          </div>
        )}
        {task?.is_orphan && (
          <p className="text-xs text-muted-foreground">
            {t(
              "paper.orphan_lock_hint",
              "המשימה לא משויכת: לאחר השמירה היא תסומן כבטיפול המשרד, וסריקת הקוד שעל הדף תציג שהמשימה נלקחה.",
            )}
          </p>
        )}
      </Card>

      <Card className="overflow-x-auto shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start">{t("apartments.building_id", "בניין")}</th>
              <th className="px-3 py-2 text-start">{t("reports.apartment_name", "מספר דירה")}</th>
              <th className="px-3 py-2 text-start">{t("apartments.name", "שם דייר")}</th>
              <th className="px-3 py-2 text-start">{t("reports.jewish_status", "מצב יהדות")}</th>
              <th className="px-3 py-2 text-start">{t("reports.mezuzah_status", "מזוזה")}</th>
              <th className="px-3 py-2 text-start">{t("reports.language", "שפה")}</th>
              <th className="px-3 py-2 text-start">{t("reports.apartment_notes", "הערות")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {apartments === null ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : apartments.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {t("paper.no_apartments", "אין דירות במשימה. אפשר עדיין לשמור את שם מבצע העבודה.")}
                </td>
              </tr>
            ) : (
              apartments.map((a) => {
                const d = drafts[a.id];
                const changed = (touched[a.id]?.size ?? 0) > 0;
                return (
                  <tr key={a.id} className={changed ? "bg-primary/5" : undefined}>
                    <td className="px-3 py-1.5">
                      {buildingDisplayName({
                        id: a.building_id,
                        building_name: a.building_name,
                        building_address: a.building_address,
                      })}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{apartmentTitle(a)}</td>
                    <td className="px-3 py-1.5">{a.name ?? ""}</td>
                    <td className="px-3 py-1.5">
                      <select
                        className={inputClass}
                        value={d?.jewish_status ?? ""}
                        onChange={(e) => edit(a.id, "jewish_status", e.target.value || null)}
                      >
                        <option value="">—</option>
                        {jewish.options.filter((o) => o.is_active).map((o) => (
                          <option key={o.id} value={o.value}>
                            {jewish.display(o)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        className={inputClass}
                        value={d?.mezuzah_status ?? ""}
                        onChange={(e) => edit(a.id, "mezuzah_status", e.target.value || null)}
                      >
                        <option value="">—</option>
                        {mezuzah.options.filter((o) => o.is_active).map((o) => (
                          <option key={o.id} value={o.value}>
                            {mezuzah.display(o)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 min-w-[9rem]">
                      <MultiSelectFilter<string>
                        allLabel="—"
                        options={language.options
                          .filter((o) => o.is_active)
                          .map((o) => ({ id: o.value, label: language.display(o) }))}
                        value={d?.language ?? []}
                        onChange={(v) => edit(a.id, "language", v)}
                      />
                    </td>
                    <td className="px-3 py-1.5 min-w-[12rem]">
                      <input
                        className={inputClass}
                        value={d?.apartment_notes ?? ""}
                        onChange={(e) => edit(a.id, "apartment_notes", e.target.value)}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-3 p-5">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("paper.notes", "הערות להזנה (לא חובה)")}</span>
          <textarea
            className={inputClass}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {formError && <p className="text-sm text-status-darkred">{formError}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? t("action.saving", "שומר…") : t("paper.save", "שמירת נתוני הדף")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("paper.changed_count", "{n} דירות עודכנו").replace("{n}", String(changedCount))}
          </span>
        </div>
      </Card>

      {history.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">{t("paper.history", "היסטוריית הזנות")}</h2>
          <ul className="divide-y divide-border text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-4 gap-y-1 py-2">
                <span className="text-muted-foreground">
                  {new Date(h.created_at + (h.created_at.endsWith("Z") ? "" : "Z")).toLocaleString("he-IL")}
                </span>
                <span>
                  {t("paper.performed_by", "בוצע על ידי")}: <strong>{performerLabel(h)}</strong>
                </span>
                <span>
                  {t("paper.entered_by", "הוזן על ידי")}: {h.entered_by_name ?? "—"}
                </span>
                <span>
                  {t("paper.changed_count", "{n} דירות עודכנו").replace("{n}", String(h.apartment_count))}
                </span>
                {h.notes && <span className="w-full text-muted-foreground">{h.notes}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </form>
  );
}
