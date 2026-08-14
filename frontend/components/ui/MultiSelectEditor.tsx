"use client";

import type { ReactNode } from "react";

import { useLocalization } from "@/lib/localization";

/**
 * fixes47: wraps a multi-select picker (AreaMultiSelect / ReportNumberMultiSelect)
 * inside an `InlineEdit` editor with an explicit apply button.
 *
 * `InlineEdit`'s default commit-on-blur doesn't fire reliably here: the
 * picker (`MultiSelectSearchFilter`) closes its own dropdown via a raw
 * `document.addEventListener("mousedown", ...)` outside-click handler. When
 * the user clicks away to finish editing, that same click also blurs
 * whatever's focused inside the picker — but since both the picker's own
 * unmount and the blur are triggered by the *same* native event, React's
 * synthetic `onBlur` on the wrapping `InlineEdit` box silently never fires
 * (confirmed live: the native DOM blur/focusout is real, but React's
 * delegated handler never sees it). The edit was never actually lost —
 * the save was simply never attempted. An explicit, unambiguous "save"
 * click sidesteps that race entirely instead of depending on blur timing.
 */
export function MultiSelectEditor({
  children,
  onApply,
}: {
  children: ReactNode;
  onApply: () => void;
}) {
  const { t } = useLocalization();
  return (
    // relative z-40: table cells collapse to content width (`w-px
    // whitespace-nowrap`), so this editor overflows its own <td> — without a
    // stacking context that overflow paints under the next cell's static
    // content. flex-col (not space-y-*): the picker's own root is
    // inline-block, so margin-based stacking would leave it inline next to
    // the button instead of above it.
    <div className="relative z-40 flex flex-col items-stretch gap-1.5">
      {children}
      <button
        type="button"
        // onMouseDown, not onClick: the picker (MultiSelectSearchFilter)
        // closes itself via a raw document-level "mousedown" listener, which
        // re-renders (and detaches) this button before a "click" event would
        // ever reach it. Acting on mousedown runs first.
        onMouseDown={(e) => {
          e.preventDefault();
          onApply();
        }}
        // relative z-50: higher than the picker's own open-dropdown panel
        // (position:absolute z-30), which renders in this same spot.
        className="relative z-50 w-full rounded-md bg-status-magenta text-white px-3 py-1.5 text-xs font-medium hover:opacity-90"
      >
        ✓ {t("action.save", "שמור")}
      </button>
    </div>
  );
}
