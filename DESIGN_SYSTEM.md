# Design System — agent-ui

Minimal, Vercel-inspired. Dark-first. Information density without visual noise.

## Principles

1. **Reduce, don't decorate.** Remove borders, shadows, and gradients unless they serve hierarchy. Let spacing and subtle background shifts create structure.
2. **One thing per level.** No tabs-within-tabs. One nav, one content area, one sidebar.
3. **Content over chrome.** Headers, labels, and instructional text cost attention. Earn every pixel.
4. **Consistent rhythm.** Use the scale. Don't invent sizes.

---

## Color Tokens

```
Canvas       #09090b    (page background)
Surface-0    #0a0a0a    (sidebar, panels at page level)
Surface-1    #111111    (cards, raised containers)
Surface-2    #1a1a1a    (interactive hover, inputs)
Surface-3    #262626    (active selection, pressed state)

Border       #ffffff0a  (white/4 — subtle structural lines, use sparingly)
Border-focus #3b82f6/40 (blue-500/40 — focus rings only)

Text-primary   #fafafa  (zinc-50)
Text-secondary #a1a1aa  (zinc-400)
Text-tertiary  #52525b  (zinc-600)
Text-ghost     #3f3f46  (zinc-700 — timestamps, metadata)

Accent-blue    #3b82f6  (primary actions, links, selected states)
Accent-green   #22c55e  (success, healthy, running)
Accent-amber   #f59e0b  (warnings, attention, waiting)
Accent-red     #ef4444  (errors, destructive actions)
```

### Status colors (used consistently everywhere)
```
Running / Active    → accent-green
Waiting / Attention → accent-amber
Error / Blocked     → accent-red
Connected / Healthy → accent-green
Idle / Inactive     → text-tertiary
```

### Accent usage
- Backgrounds: `bg-{accent}/10` (subtle tint), never solid fills except primary buttons
- Text: `text-{accent}-400` (slightly lighter than the base for contrast on dark)
- Dots/indicators: the base accent color, no shadows or glows by default

---

## Typography Scale

Only these sizes. No arbitrary `text-[11px]` or `text-[9px]`.

| Token        | Tailwind      | px   | Use case                           |
|-------------|---------------|------|------------------------------------|
| `text-2xs`  | `text-[10px]` | 10   | Timestamps, metadata, status pills |
| `text-xs`   | `text-xs`     | 12   | Labels, secondary info, pills      |
| `text-sm`   | `text-sm`     | 14   | Body text, card content, nav links |
| `text-base` | `text-base`   | 16   | Chat messages, primary text        |
| `text-lg`   | `text-lg`     | 18   | Page headings                      |
| `text-xl`   | `text-xl`     | 20   | Stat numbers, hero metrics         |

### Font weights
- `font-normal` (400): body text, descriptions
- `font-medium` (500): nav links, card titles, labels
- `font-semibold` (600): page headings, stat values

### Letter spacing
- Default for all body text
- `tracking-wide` only for section labels (e.g. "TODAY", "THIS WEEK")
- Remove all `tracking-[0.14em]`, `tracking-[0.24em]`, `tracking-[0.28em]` — replace with `tracking-wide` or nothing

---

## Spacing Scale

Use Tailwind's default 4px grid. Preferred values:

| Gap     | Value | Use case                      |
|---------|-------|-------------------------------|
| `gap-1` | 4px   | Between inline elements       |
| `gap-2` | 8px   | Between related items         |
| `gap-3` | 12px  | Between cards, list items     |
| `gap-4` | 16px  | Section spacing               |
| `gap-6` | 24px  | Between major sections        |

### Padding
- **Cards**: `p-3` (12px)
- **Page content**: `px-4 py-3` (mobile), `px-6 py-4` (desktop)
- **Sidebar**: `p-3`
- **Inputs**: `px-3 py-2`
- **Pills/badges**: `px-2 py-0.5`
- **Buttons**: `px-3 py-2` (default), `px-4 py-2.5` (primary)

---

## Border Radius

**Two sizes only:**

| Token         | Value | Use case                          |
|---------------|-------|-----------------------------------|
| `rounded-lg`  | 8px   | Cards, inputs, buttons, pills     |
| `rounded-full`| 9999  | Avatars, status dots, icon buttons |

Kill: `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-[1.75rem]`, `rounded-[2rem]`, `rounded-[1.5rem]`, `rounded-md`, `rounded-sm`.

---

## Borders & Dividers

- **Default border**: `border-white/4` — almost invisible, only for structure
- **Most containers**: NO border. Use background color shift instead (`surface-0` → `surface-1`)
- **Inputs**: `border-white/8` on focus only (transparent by default)
- **Dividers**: `border-b border-white/4` — use sparingly between major sections

### Where borders are allowed:
- Between sidebar and main content (structural)
- Input fields (on focus)
- Modal overlays
- Task column containers (optional, surface shift preferred)

### Where borders should NOT exist:
- Individual cards (use surface color instead)
- Message bubbles (use surface color)
- Pills/badges (use background tint)
- Tab bars (use active state background)
- Stats cards (use surface color)

---

## Shadows

- **None** for cards, buttons, pills
- `shadow-xl shadow-black/40` for floating menus and modals ONLY
- Remove all `shadow-[0_20px_80px...]` from message bubbles
- Remove all `shadow-[0_0_8px...]` from status dots
- Remove `backdrop-blur-xl` — it adds rendering cost for minimal visual gain

---

## Backgrounds

- **No radial gradients on body/page level.** Flat `#09090b`.
- **No backdrop-blur** unless it's a floating modal over scrolling content.
- Interactive hover: `bg-white/4` (surface shift from transparent to Surface-2)
- Active/selected: `bg-white/8`
- Cards: `bg-surface-1` (flat, no transparency games)

---

## Interactive Elements

### Buttons

**Primary** (send, create):
```
bg-accent-blue text-white rounded-lg px-4 py-2.5 text-sm font-medium
hover:bg-blue-400
```

**Secondary** (cancel, refresh, add):
```
bg-white/6 text-secondary rounded-lg px-3 py-2 text-sm
hover:bg-white/10 hover:text-primary
```

**Ghost** (toolbar actions, icon buttons):
```
text-tertiary rounded-lg p-2
hover:bg-white/6 hover:text-secondary
```

**Minimum touch target**: `min-h-9` (36px) for all interactive elements. Remove `min-h-11` (44px) everywhere — 36px is the standard.

### Status Pills

```
bg-{accent}/10 text-{accent}-400 rounded-lg px-2 py-0.5 text-2xs font-medium
```

No borders on pills. Background tint only.

---

## Component Patterns

### Nav Bar (top)
- Height: `h-12` (48px)
- Content: status dot + app name (left), nav links (center), actions (right)
- No vertical dividers between elements
- Active nav link: `text-primary font-medium`, inactive: `text-secondary`
- Border bottom: `border-b border-white/4`

### Sidebar
- No header section ("Mission Control" / "Workspace" — remove)
- Search input at top, flush
- Conversation list directly below
- No filter chips in v1 — search handles filtering
- Adapter dropdown moved to settings/preferences

### Cards (tasks, activity items)
- `bg-surface-1 rounded-lg p-3`
- No border
- Title: `text-sm font-medium text-primary`
- Metadata: `text-2xs text-ghost`
- Hover: `bg-surface-2`

### Message Bubbles
- User: `bg-accent-blue text-white rounded-lg`
- Assistant: `bg-surface-1 text-primary rounded-lg`
- No box shadows
- Action buttons (copy, retry): appear on hover, ghost style

### Stat Metrics
- Inline with dashboard, not a separate tab
- Compact: icon + number + label in a row
- No big card containers per metric

---

## Animation

- `transition-colors duration-150` for hover states
- No `animate-pulse` except for streaming indicator
- No breathing/scale animations on status dots — solid colors are enough
- Remove `backdrop-blur` transitions

---

## Responsive Breakpoints

- Mobile: `< 768px` (md) — single column, bottom tabs
- Desktop: `>= 1280px` (xl) — sidebar + main content

Mobile bottom nav: 4 items max. Same height as top nav (48px).

---

## Migration Checklist

When implementing, find-and-replace these patterns across ALL `.tsx` files:

1. `rounded-xl` → `rounded-lg`
2. `rounded-2xl` → `rounded-lg`
3. `rounded-3xl` → `rounded-lg`
4. `rounded-[1.75rem]` / `rounded-[2rem]` / `rounded-[1.5rem]` → `rounded-lg`
5. `text-[11px]` → `text-[10px]` (our `text-2xs`)
6. `text-[9px]` → `text-[10px]`
7. `text-[13px]` → `text-sm`
8. `text-[14px]` → `text-sm`
9. `tracking-[0.14em]` / `tracking-[0.24em]` / `tracking-[0.28em]` / `tracking-[0.26em]` / `tracking-[0.2em]` → `tracking-wide`
10. `min-h-11` → `min-h-9` (except touch targets that genuinely need 44px)
11. `backdrop-blur-xl` → remove
12. `shadow-[0_20px_80px...]` → remove
13. `shadow-[0_0_8px...]` / `shadow-[0_0_10px...]` / `shadow-[0_0_12px...]` → remove
14. `bg-black/20` → `bg-[#111111]` (surface-1)
15. `bg-zinc-900/80` → `bg-[#111111]`
16. `bg-zinc-900/90` → `bg-[#111111]`
17. `border-white/5` → `border-white/4`
18. `border-white/8` → `border-white/4` (or remove entirely)
19. `border-white/10` → `border-white/4` (or remove entirely)
20. Remove background radial gradients from `body` and the overlay div in App.tsx
