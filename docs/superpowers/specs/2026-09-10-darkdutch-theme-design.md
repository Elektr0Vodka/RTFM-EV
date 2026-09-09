# DarkDutch theme + layout — design

Status: approved (design phase). Date: 2026-09-10.

## Goal

Add a new **DarkDutch** appearance to the RTFM-EV frontend, derived from the
`DutchMeshCore-Branding` design system (STYLE-GUIDE.md), **minus all DutchMeshCore
identity** (no DMC logo, no "DUTCH MESHCORE" wordmark, no DMC name/social meta).
Keep the Dutch red→white→blue tricolour cue (this is what makes it "DarkDutch")
and the DMC typography (Aldrich + IBM Plex Sans + IBM Plex Mono).

DarkDutch is delivered as one more entry in RTFM-EV's existing `data-theme`
system, plus a small set of layout injections scoped to `[data-theme='darkdutch']`.
RTFM-EV's own "RemoteTerm" product identity is preserved and is not replaced.

## Non-goals

- No new messaging features. The `✓ / ✓N / ?` delivery indicators and the
  hop/path badge **already exist** in `MessageList.tsx`; DarkDutch only restyles them.
- No changes to any other theme. Every DarkDutch rule is gated on
  `[data-theme='darkdutch']`; shared-DOM additions are inert (zero-size / unstyled)
  under all other themes.
- No backend changes.
- No DMC logo, wordmark, name, or DMC social-embed meta added anywhere.

## Decisions (locked with the user)

| Decision | Choice |
| --- | --- |
| Scope | Theme **+ layout injections** (edit shared shell components, kept scoped) |
| Branding | Keep tricolour; drop DMC identity |
| Primary accent | **Blue** (`#1976e8`); green reserved for online/connected/success |
| Aldrich usage | Brand + section/conversation headers only; body/tables stay IBM Plex Sans |
| Scanline overlay | **Off** (glow background + faint 42px grid only) |
| Message indicators | **Semantic colour**: green `✓`/`✓N`, amber `?` |
| Twemoji Country Flags font | **Not wired** this pass (optional future `--font-flag`) |

## Existing architecture (verified)

- `frontend/src/index.css` — `@layer base :root {}` defines default (dark
  "Original") tokens as **HSL triplets** (`H S% L%`) consumed via `hsl(var(--token))`.
  Global `body`, scrollbar, and helper CSS live here too.
- `frontend/src/themes.css` — one `:root[data-theme='<id>'] {}` block per theme
  overriding those tokens, plus optional scoped rules
  (`[data-theme='<id>'] .bg-card { … }`, body backgrounds, button effects, etc.).
- `frontend/src/utils/theme.ts` — `THEMES[]` registry (id, name, 6 swatches,
  metaThemeColor); `applyTheme()` writes `document.documentElement.dataset.theme`
  and persists to `localStorage['remoteterm-theme']`. `'original'` = no attribute.
- `frontend/tailwind.config.js` — maps semantic classes (`bg-card`, `text-primary`,
  `border-border`, …) to `hsl(var(--token))`; `fontFamily.sans/mono` →
  `var(--font-sans)` / `var(--font-mono)`; `borderRadius` → `var(--radius)`.
- App shell: `AppShell.tsx` root is `<div className="flex flex-col h-full">`;
  first meaningful child is `StatusBar` (the topbar). `StatusBar`'s root is a
  `<header className="… bg-card border-b border-border …">` containing the
  "RemoteTerm" brand (glyph SVG + name). `.conversation-header` is an existing
  class already targeted by the `windows-95` theme (used by the per-conversation
  header). `MessageList.tsx` renders outgoing ack state at ~line 1352 as
  `✓` / `✓N` (`msg.acked`) and `?` (pending), styled today only with
  `text-muted-foreground` / `hover:text-primary` Tailwind utilities.

## Implementation

### 1. Fonts / assets

Copy from `DutchMeshCore-Branding/assets/fonts/` into
`frontend/public/fonts/` (served at `/fonts/…` by Vite):

- `aldrich-v22-latin-400.woff2`
- `ibm-plex-sans-latin-var.woff2`
- `ibm-plex-mono-latin-400.woff2`
- `ibm-plex-mono-latin-600.woff2`

Add `@font-face` blocks in `index.css` (global; `font-display: swap`). Declaring
them globally is harmless — only DarkDutch's `--font-sans` / `--font-mono` and the
Aldrich header rules actually consume them.

```css
@font-face { font-family:'Aldrich'; font-weight:400; font-display:swap;
  src:url('/fonts/aldrich-v22-latin-400.woff2') format('woff2'); }
@font-face { font-family:'IBM Plex Sans'; font-weight:100 700; font-display:swap;
  src:url('/fonts/ibm-plex-sans-latin-var.woff2') format('woff2'); }
@font-face { font-family:'IBM Plex Mono'; font-weight:400; font-display:swap;
  src:url('/fonts/ibm-plex-mono-latin-400.woff2') format('woff2'); }
@font-face { font-family:'IBM Plex Mono'; font-weight:600; font-display:swap;
  src:url('/fonts/ibm-plex-mono-latin-600.woff2') format('woff2'); }
```

### 2. Token block — `:root[data-theme='darkdutch']` in `themes.css`

DMC dark palette converted to RTFM-EV HSL triplets (values computed from the
STYLE-GUIDE hex constants). Every existing token used by other themes must be
defined so nothing falls back to Original unintentionally.

Key mappings (source hex → triplet → RTFM-EV token):

| Source | Triplet | Token(s) |
| --- | --- | --- |
| `#060709` | `220 20% 3%` | `--background`, `--overlay`, `--console-bg` |
| glass dark | `224 14% 7–8%` | `--card`, `--popover`, `--code-editor-bg` |
| `#e9edf4` | `218 33% 94%` | `--foreground`, `--card-foreground`, `--popover-foreground` |
| `#b9c1cf` | `218 19% 77%` | `--secondary-foreground`, `--accent-foreground` |
| `#6b7480` | `214 9% 46%` | `--muted-foreground`, `--status-disconnected` |
| `#1976e8` | `213 82% 50%` | `--primary`, `--ring`, `--info` |
| `#ffffff` | `0 0% 100%` | `--primary-foreground`, `--info-foreground` |
| `#3ecf8e` | `153 60% 53%` | `--success`, `--status-connected`, `--console` |
| `#f5c542` | `44 90% 61%` | `--warning`, `--favorite` |
| `#df2020` | `0 75% 50%` | `--destructive`, `--badge-mention` |
| `#ff8080` | `0 100% 75%` | `--toast-error-foreground`, `--destructive-foreground` (text) |
| translucent white surfaces | `224 12% 15–19%` | `--secondary`, `--muted`, `--accent`, `--border`, `--input` |
| region override (violet, keep app convention) | `270 80% 74%` | `--region-override` |

Also in the block:
- `--radius: 0.5rem` (DMC 8px control radius).
- `--font-sans: 'IBM Plex Sans','Segoe UI',system-ui,sans-serif;`
- `--font-mono: 'IBM Plex Mono',ui-monospace,Consolas,monospace;`
- `--msg-outgoing` / `--msg-incoming`, `--scrollbar` / `--scrollbar-hover`,
  `--console-command`, `--toast-error` / `--toast-error-border` — all defined.

Border/surface tokens that need translucency beyond a flat triplet (glass sheen,
glow) are applied through the scoped rules below, not the triplet tokens.

### 3. Scoped decorative rules (in `themes.css`)

```css
/* glow background + faint grid (scanline intentionally omitted) */
[data-theme='darkdutch'] body{
  background:
    radial-gradient(circle at 18% 18%, hsl(0 75% 50% / .15), transparent 28%),
    radial-gradient(circle at 82% 28%, hsl(213 82% 50% / .14), transparent 30%),
    linear-gradient(180deg,#090b10 0%,#06070a 48%,#030304 100%);
  background-attachment:fixed;
}
/* glass surfaces */
[data-theme='darkdutch'] .bg-card,
[data-theme='darkdutch'] .bg-popover{
  background:
    linear-gradient(135deg, hsl(0 0% 100% / .07), transparent 34%),
    linear-gradient(180deg, hsl(222 13% 10% / .94), hsl(220 20% 4% / .95));
}
/* tricolour left-border on message bubbles */
[data-theme='darkdutch'] .bg-msg-outgoing{ border-left:2px solid hsl(213 82% 50% / .6); }
[data-theme='darkdutch'] .bg-msg-incoming{ border-left:2px solid hsl(0 75% 50% / .35); }
```

The faint grid overlay is added on the AppShell root (an element that already
spans the shell), gated on the theme, radially masked, opacity ≈ .28.

### 4. Layout injections (shared-DOM edits, scoped styling)

1. **Tricolour top stripe** — in `AppShell.tsx`, add as the first child of the root
   `<div className="flex flex-col h-full">`:
   `<div className="page-stripe" aria-hidden="true" />`.
   In `index.css`, `.page-stripe{ display:none }` globally; in `themes.css`,
   `[data-theme='darkdutch'] .page-stripe{ display:block; height:4px; flex:0 0 4px;
   background:linear-gradient(90deg,#df2020,#f4f4f5 50%,#1976e8); }`.
2. **Glass topbar** — add a stable class `app-statusbar` to `StatusBar`'s
   `<header>`. `[data-theme='darkdutch'] .app-statusbar{ background:hsl(220 30% 2% / .88);
   backdrop-filter:blur(16px); border-bottom:1px solid hsl(0 0% 100% / .14); … }`.
   Brand name → Aldrich uppercase (via a class on the `<h1>` brand text).
3. **Glass conversation header** — restyle existing `.conversation-header` under the
   theme (blur + translucent fill); add a tricolour chevron `::before`.
4. **Aldrich headers** — apply Aldrich uppercase to: topbar brand, sidebar section
   labels, conversation header title. Add minimal stable classes only where no
   existing selector is reliable; do **not** blanket-style all `h1/h2/h3`.

All added classes are plain markers; under non-DarkDutch themes they carry no rules.

### 5. Message indicators (option B)

In `MessageList.tsx`, add stable classes to the existing ack/pending spans
(keeping their current Tailwind classes so other themes are unchanged):
- acked `✓` / `✓N` span → add `msg-ack`
- pending `?` span → add `msg-ack-pending`

In `themes.css`:
```css
[data-theme='darkdutch'] .msg-ack{ color:hsl(153 60% 53%); text-shadow:0 0 6px hsl(153 60% 53% / .4); }
[data-theme='darkdutch'] .msg-ack-pending{ color:hsl(44 90% 61%); }
```

### 6. Registration — `theme.ts`

Append to `THEMES[]`:
```ts
{ id:'darkdutch', name:'DarkDutch',
  swatches:['#060709','#12151b','#1976e8','#1b1f27','#df2020','#3ecf8e'],
  metaThemeColor:'#060709' },
```
No other `theme.ts` logic changes; the picker renders it automatically.

## Files touched

- `frontend/public/fonts/*.woff2` (new — copied assets)
- `frontend/src/index.css` (@font-face; global `.page-stripe{display:none}`)
- `frontend/src/themes.css` (new `darkdutch` block + scoped rules)
- `frontend/src/utils/theme.ts` (registry entry)
- `frontend/src/components/AppShell.tsx` (stripe element)
- `frontend/src/components/StatusBar.tsx` (`app-statusbar` class + brand class)
- `frontend/src/components/MessageList.tsx` (indicator classes)
- possibly `Sidebar.tsx` / conversation-header component (minimal Aldrich class hooks)

## Verification (evidence required before claiming done)

1. `npm run build` (or typecheck) passes — output shown.
2. App runs; select **DarkDutch** and observe (screenshots):
   - tricolour stripe, glass topbar with Aldrich "RemoteTerm" brand;
   - sidebar + a channel showing acked `✓`/`✓N` (green) and a pending `?` (amber),
     plus an incoming hop badge;
   - fonts actually loaded (IBM Plex / Aldrich, not fallback).
3. Switch to at least one other theme (e.g. Original, Windows 95) and confirm it is
   visually unchanged and the stripe/glass rules do not apply — proving isolation.
4. Confirm no DMC logo/wordmark/name appears anywhere in the theme.

## Risks

- **Token completeness**: a missing token in the block silently falls back to
  Original. Mitigation: diff the block's token list against `index.css` `:root`.
- **Selector drift**: relying on `.conversation-header` / utility classes. Mitigation:
  add explicit marker classes where a selector is not clearly stable; verify at runtime.
- **Font path**: Vite serves `public/` at root; confirm `/fonts/*.woff2` resolves in
  both dev and production build.
