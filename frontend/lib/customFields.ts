"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "./api";
import type { CustomFieldDefinition, CustomFieldEntityType } from "./types";

/** fixes35: the org's active custom field definitions for one entity type,
 *  fetched once — shared by every entity's CRUD form and the apartments/
 *  contacts list pages. Select-type definitions are included too (their
 *  values just live in picklist_values instead of custom_field_values). */
export function useCustomFieldDefs(entityType: CustomFieldEntityType) {
  const [defs, setDefs] = useState<CustomFieldDefinition[]>([]);

  useEffect(() => {
    let active = true;
    apiFetch<CustomFieldDefinition[]>(`/api/custom-fields?entity_type=${entityType}`)
      .then((rows) => {
        if (active) setDefs(rows);
      })
      .catch(() => {
        if (active) setDefs([]);
      });
    return () => {
      active = false;
    };
  }, [entityType]);

  return defs;
}
