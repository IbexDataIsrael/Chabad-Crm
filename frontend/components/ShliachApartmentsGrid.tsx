"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import {
  apartmentTitle,
  buildingDisplayName,
  type ApartmentPage,
} from "@/lib/types";

/**
 * The apartments assigned to one shliach contact, as an embedded paginated
 * sub-grid on the shliach profile (fixes15 §4.2). Server-filtered via the
 * apartments list's `shliach_contact_id` param.
 */
export function ShliachApartmentsGrid({ contactId }: { contactId: number }) {
  const { t } = useLocalization();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ApartmentPage | null>(null);
  const pageSize = 20;

  useEffect(() => {
    apiFetch<ApartmentPage>(
      `/api/apartments/list?shliach_contact_id=${contactId}&page=${page}&page_size=${pageSize}`,
    )
      .then(setData)
      .catch(() => setData({ items: [], total: 0, page: 1, page_size: pageSize }));
  }, [contactId, page]);

  if (data === null) {
    return <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>;
  }
  if (data.total === 0) {
    return (
      <p className="text-sm text-gray-400">
        {t("page.no_covered_apartments", "אין דירות משויכות לפעיל זה.")}
      </p>
    );
  }

  const lastPage = Math.max(1, Math.ceil(data.total / pageSize));

  return (
    <div className="space-y-2">
      <div className="divide-y divide-gray-100">
        {data.items.map((a) => (
          <div key={a.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
            <Link
              href={`/dashboard/apartments/${a.id}`}
              className="font-medium text-status-magenta hover:underline min-w-[4rem]"
            >
              {apartmentTitle(a)}
            </Link>
            <span className="text-gray-500">
              {[
                buildingDisplayName({
                  id: a.building_id,
                  building_name: a.building_name,
                  building_address: a.building_address,
                }),
                a.area_name,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {a.contact_id ? (
              <Link
                href={`/dashboard/contacts/${a.contact_id}`}
                className="ms-auto rounded-full bg-status-magenta/10 text-status-magenta px-3 py-0.5 hover:bg-status-magenta/20"
              >
                {a.contact_name}
              </Link>
            ) : (
              <span className="ms-auto text-gray-400">
                {t("apt.no_contact", "ללא איש קשר")}
              </span>
            )}
          </div>
        ))}
      </div>
      {lastPage > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-40"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-gray-500">
            {t("pager.range", "{from}–{to} מתוך {total}")
              .replace("{from}", String((page - 1) * pageSize + 1))
              .replace("{to}", String(Math.min(page * pageSize, data.total)))
              .replace("{total}", String(data.total))}
          </span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
            className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-40"
          >
            {t("pager.next", "הבא ←")}
          </button>
        </div>
      )}
    </div>
  );
}
