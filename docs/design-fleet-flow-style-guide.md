# Design port: fleet-flow-zippy-pro1 → sheepsidebay_crm

Branch: `design/fleet-flow-port`. This doc is the single source of truth for
the visual re-skin so every file ends up consistent. It is scoped to
**presentation only** — no behavior, state, data-fetching, or prop-contract
changes anywhere.

## What already happened (don't redo)

1. `frontend/tailwind.config.js` — added shadcn-style semantic color tokens
   (`background/foreground/card/popover/primary/secondary/muted/accent/
   destructive/success/warning/border/input/ring/sidebar-*`), all HSL-CSS-var
   based. `borderRadius.lg/md/sm` now read `var(--radius)` — this means every
   *existing* `rounded-sm/md/lg` class in the whole codebase already renders
   the new radius scale with zero file edits. The old `status.{magenta,green,
   yellow,darkred,orange}` colors (CLAUDE.md's required markers) are
   untouched and still used directly where the code already used them.
2. `frontend/app/globals.css` — the CSS variables (light theme only, no dark
   mode), `--radius: 0.75rem`, Heebo wired through `--font-sans` (not
   `--font-heebo` directly on body — that variable is dynamically overridden
   by `LabelStyleInjector.tsx` when an org sets a custom font; don't disturb
   that indirection).
3. A global scripted find/replace already ran across every `.ts`/`.tsx` under
   `frontend/app` and `frontend/components`:
   - `bg-white` → `bg-card`
   - `bg-gray-50` → `bg-background`
   - `border-gray-200` → `border-border`
   - `border-gray-300` → `border-input`
   - `text-gray-900/800/700` → `text-foreground`
   - `text-gray-600/500/400` → `text-muted-foreground`
   - `hover:bg-gray-50` / `hover:bg-gray-100` → `hover:bg-accent`
   So every file already has correct token colors. **Your job is
   componentization and polish on top of that, not color fixing** — only
   touch colors where something was missed (e.g. `bg-red-50`, `bg-gray-100`
   as a non-hover background, hardcoded hex).
4. New primitives exist at `frontend/components/ui/{button,card,badge,input,
   label}.tsx` — CVA-based, same API as shadcn/ui. Import them, don't
   recreate them.
5. `frontend/app/dashboard/layout.tsx` + new `frontend/components/layout/
   Sidebar.tsx` — the whole chrome (RTL right-side sidebar, grouped nav with
   lucide icons, sticky blurred header) is done. Don't touch these.
6. `frontend/app/page.tsx` (login) is converted — use it as your reference
   example for a form-heavy page.
7. `frontend/components/{GlobalSearch,LanguageToggle,Footer}.tsx` are done.

## Primitives — import paths and when to use them

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
```

- **Button** — replace plain `<button className="rounded-md ...">` with
  `<Button>`. Variants: `default` (primary/magenta fill), `destructive`,
  `outline`, `secondary`, `ghost`, `link`. Sizes: `default`, `sm`, `lg`,
  `icon`. Pass extra classes via `className` (merged with `cn`, so
  `className="w-full"` etc. is safe). Keep the original `onClick`/`type`/
  `disabled` props exactly as they were.
- **Card** — wrap a panel that was `<div className="bg-card border ... rounded-* shadow ...">`
  in `<Card className="p-6">` (Card already ships `rounded-xl border
  bg-card shadow`; don't double up on those classes). Use `CardHeader`/
  `CardTitle`/`CardContent` only where it's a clean fit — don't force a
  restructure of complex layouts, a bare `<Card className="p-6">…</Card>` is
  fine.
- **Badge** — replace ad hoc `<span className="rounded px-2 py-0.5 text-xs ...">`
  status/tag chips. Variants `default/secondary/destructive/success/warning/
  outline` for semantic states, and `status-magenta/status-green/status-
  yellow/status-darkred/status-orange` when the chip must show one of the
  CLAUDE.md spreadsheet-marker colors specifically (e.g. a picklist color tag)
  rather than a semantic state.
- **Input** — replace plain `<input className="rounded-md border ...">` text/
  email/number/date inputs. Don't wrap `<select>`, custom combobox, or
  map-picker inputs in this — leave those as-is unless they're simple text
  inputs.
- **Label** — replace `<label className="block text-sm font-medium">`.

Icons: `lucide-react` is installed. Add small icons (`h-4 w-4`/`h-5 w-5`) next
to buttons/section headers/empty-states where fleet-flow-zippy-pro1 does —
don't go overboard; one icon per action button / card header is the pattern,
not decorative icons everywhere. Pick semantically obvious icons (Plus for
"add", Trash2 for delete, Search for search, Pencil for edit, etc.).

## Hard rules

1. **Never touch logic.** No changes to `useState`/`useEffect`/handlers, API
   calls, prop types/interfaces, routing, or business rules. If a `<button
   onClick={...}>` becomes `<Button onClick={...}>`, the handler must be
   byte-identical.
2. **Never change component public props/exports.** Other files import these
   — changing a signature breaks callers you can't see in your batch.
3. Leave complex bespoke widgets (maps, drag-and-drop reorder lists, the
   apartment/contact grid tables, rich text editor toolbar, date pickers)
   **structurally alone** — only restyle their outer wrapper/container
   classes and simple leaf buttons/inputs inside them. Do not attempt to
   redesign a data table into a fleet-flow-style card grid — this app's
   dense, configurable tables are intentional (power-user feature), fleet-
   flow's simpler card-grid list is not the target for those.
4. RTL: this app is `dir="rtl"` site-wide. Use logical properties already in
   use elsewhere (`ms-*`/`me-*`/`ps-*`/`pe-*`/`start-*`/`end-*`) — don't
   introduce `ml-*`/`mr-*`/`left-*`/`right-*` on new markup.
5. After your batch, run `npx tsc --noEmit` from `frontend/` and fix any
   error your edits introduced before finishing. Don't fix pre-existing
   unrelated errors.
6. Don't run any `git` commands (no commits) — the coordinator handles that.
7. Only touch the files in your assigned list. If you notice something
   broken in a file outside your list, mention it in your report instead of
   editing it.

## Visual reference (fleet-flow-zippy-pro1, at repo root, gitignored)

- `src/pages/Clients.jsx` — list page pattern (header + count, search bar,
  segmented sort control, card grid with hover states, icon + text rows).
- `src/pages/Login.jsx` + `src/components/AuthLayout.jsx` — centered card
  auth pattern (already ported to `frontend/app/page.tsx`).
- `src/components/dashboard/StatCard.jsx` — icon-in-tinted-box stat tile
  pattern, useful for dashboard-style summary numbers.
- `src/components/ui/button.jsx`, `card.jsx`, `badge.jsx` — the exact variant
  vocabulary the new primitives were ported from.

Common transformation shape for a toolbar/header block:

```tsx
// before
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold text-foreground">לקוחות</h1>
  <button onClick={openNew} className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm hover:opacity-90">
    + לקוח חדש
  </button>
</div>

// after
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold text-foreground">לקוחות</h1>
  <Button onClick={openNew}>
    <Plus className="h-4 w-4" /> לקוח חדש
  </Button>
</div>
```
