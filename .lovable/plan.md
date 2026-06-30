## The Helm — Executive Redesign (one pass)

Goal: turn The Helm into a high-density, executive-grade command center where every tile is visibly bounded, every tile opens a full overlay, the email reader behaves like a real inbox, and the calendar mirrors an Outlook week view.

### 1. New visual system — accent-edged tiles

Every tile (hero KPIs and the smaller breakdown row) gets:
- Dark surface `bg-card/60` with `border border-border/60` and a subtle backdrop blur so the tile shape is always visible on dark mode (no more floating text).
- A 3-px colored left edge that maps to category:
  - Total inbound — slate
  - Needs you — amber (`#F59E0B`)
  - Handled for you — emerald (`#10B981`)
  - Big 3 — sky
  - Decisions — violet
  - Overdue — red
  - AI-drafted — cyan
  - Auto-handled — emerald
  - FYI — muted
- Hover: edge brightens + tile lifts (`shadow-lg`, `-translate-y-0.5`) — the existing blue ring stays.
- Tighter type scale: KPI numbers `text-4xl` (was 5xl), labels stay `text-overline`, sublabel `text-xs` — fits more per row without losing the look from screenshot #1 the user liked.

### 2. Tiles open as full overlays (not inline sections)

Today every tile scrolls to an inline section. Replace with a single `HelmOverlay` dialog component that opens on top of The Helm at full viewport, with a close button and the same header strip.

Overlay variants:
- **Email scopes** (Big 3, Decisions, Overdue, AI-drafted, Auto-handled, FYI, Needs you) → inbox overlay (section 3).
- **Calendar tile / "This week" panel** → calendar overlay (section 4).
- **Total inbound / Handled for you** → read-only summary list overlay.

Clicking a tile sets `openOverlay = { kind, scope }`; ESC / close button clears it. URL stays on `/helm`.

### 3. Inbox-style email overlay

Three-pane layout, fixed height of viewport:

```text
+---------------------------+----------------------------------+
| LEFT (320px)              | RIGHT (flex-1)                   |
| Scope title + count       | Subject + sender + meta          |
| Scrollable email list     |----------------------------------|
| - sender, subject, time   | Original thread (scrollable)     |
| - selected = accent edge  | dark-mode safe: force            |
|                           | text-foreground on injected HTML |
|                           |----------------------------------|
|                           | AI draft (auto-generated)        |
|                           | Tone chips + free-text edit      |
|                           | [Approve & Send] [Schedule]      |
+---------------------------+----------------------------------+
```

Behavior:
- Opening overlay auto-selects first item and triggers `helm-draft-reply` if no draft exists.
- After Approve & Send: optimistic remove from list, invalidate `helm-items`, advance to next item. This fixes the "Big 3 always shows 3" bug — current code only prunes from the cache for one scope; new overlay prunes from the source list and refetches.
- Dark-mode body readability: render the original message inside a wrapper with `prose prose-invert` plus a CSS override that forces `color: hsl(var(--foreground))` on all descendants and strips inline `color`/`background` from injected Outlook HTML.

### 4. Outlook-style week calendar overlay

Replace the current calendar overlay with a 7-column week grid:
- Columns: Mon–Sun (current week, navigable with arrows).
- Rows: hourly slots 7am–8pm with 30-min subdivision.
- Events render as absolutely-positioned blocks within their day column, color-coded by category (internal / external / focus).
- "Today" column has a highlighted background and a red current-time line.
- AI recommendations panel collapses into a slim 56-px footer strip with a "Show AI suggestions" expander; expanding slides it up to ~40% height so the calendar stays primary.

### 5. Big 3 bug fix

Root cause: after send, `TheHelm` removes the item only from a derived list, but `useHelmData` keeps returning the stale row until the next refetch — and the `big3` slice is recomputed from the same stale rows. Fix:
- After `email-send` success, call `queryClient.setQueryData(['helm-items'], …)` to drop the row by id from the source array, then `invalidateQueries(['helm-items'])`.
- Also mark `helm_items.status = 'sent'` server-side via the existing send path (already does this) so the next fetch excludes it.
- Surface the new count immediately in the hero ("29 things need you today" decrements with the queue).

### 6. Page-wide polish

- Sticky compact header (date · brief · print/email/sync buttons) — current header stays but shrinks on scroll.
- Hero line keeps "Good evening, Ali. 29 things need you today." (already correct).
- Right rail (This week / Inbox health) becomes sticky on `lg+`.
- "Print" / "Email me" per-section buttons stay but move into the overlay header so the Helm landing stays clean.
- Remove the now-redundant inline accordions ("Show 26 overdue threads", etc.) — those rows simply launch the overlay.

### 7. Technical notes

Files touched:
- `src/pages/TheHelm.tsx` — replace tile components, remove inline scopes, wire overlay state.
- New `src/components/helm/HelmTile.tsx` — accent-edged tile primitive (variants: hero | compact).
- New `src/components/helm/HelmOverlay.tsx` — dialog shell + scope router.
- New `src/components/helm/InboxOverlay.tsx` — 3-pane reader, owns selection + send mutation.
- New `src/components/helm/WeekCalendarOverlay.tsx` — Outlook-style grid; data from existing `useCalendarEvents` hook.
- New `src/components/helm/EmailBody.tsx` — sanitizes + force-recolors injected HTML for dark mode.
- `src/index.css` — add `.helm-email-body` overrides (`color: hsl(var(--foreground)) !important` on `*` inside, drop `bgcolor`, neutralize `<font color>`).

No backend / RLS changes. No new tables. Existing edge functions (`helm-draft-reply`, `email-send`) unchanged.

### 8. Out of scope (this pass)

- Print/email template rework (still works, layout untouched).
- Settings, Flagged Tracker, AI Intelligence — not part of The Helm redesign.
