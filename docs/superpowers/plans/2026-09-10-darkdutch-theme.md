# DarkDutch Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "DarkDutch" appearance to the RTFM-EV frontend — the DutchMeshCore visual system (dark glass, tricolour accents, Aldrich + IBM Plex fonts) minus all DMC identity — as a new `data-theme` plus scoped layout injections.

**Architecture:** DarkDutch is a new `:root[data-theme='darkdutch']` token block in `themes.css` (RTFM-EV's established per-theme override pattern), registered in `theme.ts`. A few shared shell components gain inert marker classes / one DOM element; every visual rule is gated on `[data-theme='darkdutch']` so all other themes are byte-for-byte unaffected. No messaging behaviour changes.

**Tech Stack:** React + TypeScript + Vite + Tailwind (HSL-triplet CSS custom properties consumed via `hsl(var(--token))`).

**Spec:** `docs/superpowers/specs/2026-09-10-darkdutch-theme-design.md`

---

## Git policy (repo rule — overrides default)

This repo's CLAUDE.md forbids commits unless the user explicitly instructs. Each **Commit** step below is written out ready to run, but **only run it if the user has authorized committing for this session**. Otherwise, stop at staging (`git add …`) and show `git status` / `git diff --staged` for review. Branch naming, when relevant, uses `feat/…` (never `claude/…`); pushes/PRs target `origin` (the fork), never upstream.

## File Structure

- `frontend/public/fonts/*.woff2` — **create** (copied assets): Aldrich, IBM Plex Sans var, IBM Plex Mono 400/600.
- `frontend/src/index.css` — **modify**: add `@font-face` blocks; add global `.page-stripe { display:none }`.
- `frontend/src/themes.css` — **modify**: add the `darkdutch` token block + all scoped rules (palette, glow bg, grid, glass, stripe, topbar, conversation header, Aldrich headers, message indicators).
- `frontend/src/utils/theme.ts` — **modify**: append the `darkdutch` entry to `THEMES[]`.
- `frontend/src/components/AppShell.tsx` — **modify**: add the tricolour stripe element.
- `frontend/src/components/StatusBar.tsx` — **modify**: add `app-statusbar` class to the header.
- `frontend/src/components/Sidebar.tsx` — **modify**: add `dd-section-label` class to the section-label button.
- `frontend/src/components/MessageList.tsx` — **modify**: add `msg-ack` / `msg-ack-pending` classes to the ack/pending spans.

Verification is by build/typecheck + runtime observation (this is CSS/theme work; there are no unit tests to write). Confirm wiring with `grep` where useful.

---

## Task 1: Font assets + @font-face + global stripe hidden

**Files:**
- Create: `frontend/public/fonts/aldrich-v22-latin-400.woff2`, `ibm-plex-sans-latin-var.woff2`, `ibm-plex-mono-latin-400.woff2`, `ibm-plex-mono-latin-600.woff2`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Copy the four woff2 files**

Run (Bash tool):
```bash
SRC="G:/Github/repositories/Dutch-MeshCore/DutchMeshCore-Branding/assets/fonts"
DST="G:/Github/repositories/Elektr0Vodka/RTFM-EV/.claude/worktrees/darkdutch-rtfm-ev-theme-73fdec/frontend/public/fonts"
mkdir -p "$DST"
cp "$SRC/aldrich-v22-latin-400.woff2" "$SRC/ibm-plex-sans-latin-var.woff2" \
   "$SRC/ibm-plex-mono-latin-400.woff2" "$SRC/ibm-plex-mono-latin-600.woff2" "$DST/"
ls -1 "$DST"
```
Expected: the four filenames listed.

- [ ] **Step 2: Add @font-face + hidden stripe to `index.css`**

At the top of `frontend/src/index.css`, immediately after the three `@tailwind` lines, insert:

```css
/* DarkDutch fonts (declared globally; only the DarkDutch theme consumes them) */
@font-face {
  font-family: 'Aldrich';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/aldrich-v22-latin-400.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 100 700;
  font-display: swap;
  src: url('/fonts/ibm-plex-sans-latin-var.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/ibm-plex-mono-latin-400.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/ibm-plex-mono-latin-600.woff2') format('woff2');
}

/* Tricolour top stripe: hidden by default; DarkDutch enables it (see themes.css) */
.page-stripe {
  display: none;
}
```

- [ ] **Step 3: Verify build still compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (no CSS parse errors).

- [ ] **Step 4 (optional): Commit** — only if committing is authorized (see Git policy)

```bash
git add frontend/public/fonts frontend/src/index.css
git commit -m "feat(theme): add DarkDutch fonts and hidden page-stripe base"
```

---

## Task 2: DarkDutch token block + scoped rules in `themes.css`

**Files:**
- Modify: `frontend/src/themes.css`

- [ ] **Step 1: Append the DarkDutch token block**

At the END of `frontend/src/themes.css`, append:

```css
/* ── DarkDutch ("Dutch Glass") ─────────────────────────────── */
:root[data-theme='darkdutch'] {
  --background: 220 20% 3%;
  --foreground: 218 33% 94%;
  --card: 224 14% 8%;
  --card-foreground: 218 33% 94%;
  --popover: 224 14% 9%;
  --popover-foreground: 218 33% 94%;
  --primary: 213 82% 50%;
  --primary-foreground: 0 0% 100%;
  --secondary: 224 12% 15%;
  --secondary-foreground: 218 19% 82%;
  --muted: 224 12% 13%;
  --muted-foreground: 218 19% 77%;
  --accent: 224 11% 18%;
  --accent-foreground: 218 33% 94%;
  --destructive: 0 75% 50%;
  --destructive-foreground: 0 0% 100%;
  --border: 220 10% 20%;
  --input: 220 10% 20%;
  --ring: 213 82% 50%;
  --radius: 0.5rem;
  --msg-outgoing: 213 40% 12%;
  --msg-incoming: 224 12% 11%;
  --status-connected: 153 60% 53%;
  --status-disconnected: 214 9% 46%;
  --warning: 44 90% 61%;
  --warning-foreground: 44 90% 10%;
  --success: 153 60% 53%;
  --success-foreground: 153 60% 8%;
  --info: 213 82% 55%;
  --info-foreground: 0 0% 100%;
  --region-override: 270 80% 74%;
  --favorite: 44 90% 61%;
  --console: 153 60% 58%;
  --console-command: 153 65% 70%;
  --console-bg: 220 25% 2%;
  --toast-error: 0 40% 12%;
  --toast-error-foreground: 0 100% 78%;
  --toast-error-border: 0 35% 24%;
  --code-editor-bg: 224 14% 6%;
  --font-sans: 'IBM Plex Sans', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, Consolas, 'Fira Mono', monospace;
  --scrollbar: 220 12% 18%;
  --scrollbar-hover: 213 40% 28%;
  --overlay: 220 30% 2%;
}
```

- [ ] **Step 2: Append the scoped decorative + layout rules**

Immediately after the block from Step 1, append:

```css
/* DarkDutch: tricolour top stripe (base is display:none in index.css) */
[data-theme='darkdutch'] .page-stripe {
  display: block;
  height: 4px;
  flex: 0 0 4px;
  background: linear-gradient(90deg, #df2020, #f4f4f5 50%, #1976e8);
}

/* DarkDutch: glow background (scanline intentionally omitted) */
[data-theme='darkdutch'] body {
  background:
    radial-gradient(circle at 18% 18%, hsl(0 75% 50% / 0.15), transparent 28%),
    radial-gradient(circle at 82% 28%, hsl(213 82% 50% / 0.14), transparent 30%),
    linear-gradient(180deg, #090b10 0%, #06070a 48%, #030304 100%);
  background-attachment: fixed;
}

/* DarkDutch: glass surfaces */
[data-theme='darkdutch'] .bg-card,
[data-theme='darkdutch'] .bg-popover {
  background:
    linear-gradient(135deg, hsl(0 0% 100% / 0.07), transparent 34%),
    linear-gradient(180deg, hsl(222 13% 10% / 0.94), hsl(220 20% 4% / 0.95));
}

/* DarkDutch: glass topbar */
[data-theme='darkdutch'] .app-statusbar {
  background: hsl(220 30% 2% / 0.88);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid hsl(0 0% 100% / 0.14);
  box-shadow: 0 1px 0 hsl(0 0% 100% / 0.03), 0 8px 24px hsl(0 0% 0% / 0.35);
}

/* DarkDutch: glass conversation header + tricolour chevron */
[data-theme='darkdutch'] .conversation-header {
  background: hsl(220 30% 2% / 0.72);
  backdrop-filter: blur(12px);
}
[data-theme='darkdutch'] .conversation-header::before {
  content: '';
  align-self: center;
  width: 10px;
  height: 15px;
  margin-right: 8px;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  background: linear-gradient(180deg, #df2020, #f4f4f5 50%, #1976e8);
}

/* DarkDutch: Aldrich display type on brand + section/conversation headers only */
[data-theme='darkdutch'] .app-statusbar h1,
[data-theme='darkdutch'] .conversation-header h2,
[data-theme='darkdutch'] .dd-section-label {
  font-family: 'Aldrich', 'Segoe UI', system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* DarkDutch: tricolour left-borders on message bubbles */
[data-theme='darkdutch'] .bg-msg-outgoing {
  border-left: 2px solid hsl(213 82% 50% / 0.6);
}
[data-theme='darkdutch'] .bg-msg-incoming {
  border-left: 2px solid hsl(0 75% 50% / 0.35);
}

/* DarkDutch: semantic message delivery indicators */
[data-theme='darkdutch'] .msg-ack {
  color: hsl(153 60% 53%);
  text-shadow: 0 0 6px hsl(153 60% 53% / 0.4);
}
[data-theme='darkdutch'] .msg-ack-pending {
  color: hsl(44 90% 61%);
}
```

- [ ] **Step 3: Verify build compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Verify token completeness (no accidental fallback)**

Run (Bash tool) — every token defined in the base `:root` (index.css) should also appear in the DarkDutch block, except the `var()`-based aliases (`--badge-unread`, `--badge-mention`, and the `--sidebar-*` set) which intentionally inherit:
```bash
cd frontend/src
comm -23 \
  <(grep -oE '^\s*--[a-z-]+:' index.css | tr -d ' :' | sort -u) \
  <(awk "/data-theme='darkdutch'/{f=1} f&&/^}/{f=0} f" themes.css | grep -oE '\-\-[a-z-]+:' | tr -d ':' | sort -u)
```
Expected: only `--badge-mention`, `--badge-mention-foreground`, `--badge-unread`, `--badge-unread-foreground`, and the `--sidebar-*` names remain (these inherit via `var()`). If any color/surface token appears, add it to the block.

- [ ] **Step 5 (optional): Commit** — only if authorized

```bash
git add frontend/src/themes.css
git commit -m "feat(theme): add DarkDutch palette and scoped decorative rules"
```

---

## Task 3: Register DarkDutch in the theme picker

**Files:**
- Modify: `frontend/src/utils/theme.ts`

- [ ] **Step 1: Append the registry entry**

In `frontend/src/utils/theme.ts`, inside the `THEMES` array, add as the final entry (after the `windows-95` object, before the closing `];`):

```ts
  {
    id: 'darkdutch',
    name: 'DarkDutch',
    swatches: ['#060709', '#12151b', '#1976e8', '#1b1f27', '#df2020', '#3ecf8e'],
    metaThemeColor: '#060709',
  },
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3 (optional): Commit** — only if authorized

```bash
git add frontend/src/utils/theme.ts
git commit -m "feat(theme): register DarkDutch in theme picker"
```

---

## Task 4: Tricolour stripe element in AppShell

**Files:**
- Modify: `frontend/src/components/AppShell.tsx`

- [ ] **Step 1: Add the stripe as the first child of the shell root**

In `frontend/src/components/AppShell.tsx`, the root element is:
```tsx
return (
    <div className="flex flex-col h-full" {...swipeHandlers}>
      <a
        href="#main-content"
```
Insert the stripe as the very first child, immediately after the opening `<div … {...swipeHandlers}>` line and before the `<a href="#main-content" …>`:
```tsx
      <div className="page-stripe" aria-hidden="true" />
```

- [ ] **Step 2: Typecheck + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 3: Confirm the element is inert for other themes**

The `.page-stripe { display:none }` base rule (Task 1) means this element renders nothing unless `[data-theme='darkdutch']` is active. No per-theme conditional in React is needed.

- [ ] **Step 4 (optional): Commit** — only if authorized

```bash
git add frontend/src/components/AppShell.tsx
git commit -m "feat(theme): add tricolour page-stripe element to app shell"
```

---

## Task 5: Glass-topbar hook in StatusBar

**Files:**
- Modify: `frontend/src/components/StatusBar.tsx`

- [ ] **Step 1: Add the `app-statusbar` class to the header**

In `frontend/src/components/StatusBar.tsx`, the return opens with:
```tsx
    <header className="flex items-center gap-3 px-4 py-2.5 bg-card border-b border-border text-xs">
```
Change it to prepend the marker class:
```tsx
    <header className="app-statusbar flex items-center gap-3 px-4 py-2.5 bg-card border-b border-border text-xs">
```
(The `app-statusbar` class carries rules only under DarkDutch; all other themes still render the plain `bg-card border-b border-border` header.)

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3 (optional): Commit** — only if authorized

```bash
git add frontend/src/components/StatusBar.tsx
git commit -m "feat(theme): add app-statusbar hook for DarkDutch glass topbar"
```

---

## Task 6: Aldrich hook on sidebar section labels

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Locate the section-label button**

Run (Bash tool) to confirm the current class string:
```bash
grep -n "uppercase tracking-wider text-muted-foreground" \
  "G:/Github/repositories/Elektr0Vodka/RTFM-EV/.claude/worktrees/darkdutch-rtfm-ev-theme-73fdec/frontend/src/components/Sidebar.tsx"
```
Expected: one hit (around line 848) — a `<button>` className that begins `flex items-center gap-1.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground …`.

- [ ] **Step 2: Add the `dd-section-label` marker class**

In that className string, prepend `dd-section-label`:
```tsx
            'dd-section-label flex items-center gap-1.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded',
```
(This is the collapsible group header — one JSX button rendered per sidebar group, so the class covers every section label. The class is inert outside DarkDutch.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4 (optional): Commit** — only if authorized

```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "feat(theme): add dd-section-label hook for DarkDutch headings"
```

---

## Task 7: Semantic message-indicator hooks in MessageList

**Files:**
- Modify: `frontend/src/components/MessageList.tsx`

- [ ] **Step 1: Locate the ack/pending spans**

Run (Bash tool):
```bash
grep -n "✓\|No repeats heard yet" \
  "G:/Github/repositories/Elektr0Vodka/RTFM-EV/.claude/worktrees/darkdutch-rtfm-ev-theme-73fdec/frontend/src/components/MessageList.tsx"
```
Expected: hits around lines 1372, 1374 (the `✓${…}` acked spans) and ~1399 (the `?` pending span with `title="No repeats heard yet"`).

- [ ] **Step 2: Add `msg-ack` to both acked `✓` spans**

There are two acked spans (one wrapped in a clickable path button, one plain). Add `msg-ack` to each `className`:

The clickable one (currently `className="text-muted-foreground cursor-pointer hover:text-primary"`):
```tsx
                              className="msg-ack text-muted-foreground cursor-pointer hover:text-primary"
```
The plain one (currently `className="text-muted-foreground"` wrapping `✓${…}`):
```tsx
                            <span className="msg-ack text-muted-foreground">{` ✓${msg.acked > 1 ? msg.acked : ''}`}</span>
```

- [ ] **Step 3: Add `msg-ack-pending` to the `?` pending span**

The pending span (currently `className="text-muted-foreground" title="No repeats heard yet"`):
```tsx
                          <span className="msg-ack-pending text-muted-foreground" title="No repeats heard yet">
```

Note: the mid-block `?` used for the resend affordance (`msg.type === 'CHAN'`, has an `onClick`) is a different control — leave it unchanged; only tag the final "No repeats heard yet" pending span.

- [ ] **Step 4: Typecheck + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 5 (optional): Commit** — only if authorized

```bash
git add frontend/src/components/MessageList.tsx
git commit -m "feat(theme): tag ack indicators for DarkDutch semantic colours"
```

---

## Task 8: Runtime verification (evidence before "done")

**Files:** none (observation only).

- [ ] **Step 1: Start the app**

Use the `run` skill (or the project's dev command) to launch the frontend, then open it in the Browser pane.

- [ ] **Step 2: Select DarkDutch and observe**

In the app, open the theme picker and choose **DarkDutch**. Screenshot and confirm ALL of:
- 4px tricolour (red→white→blue) stripe pinned at the very top;
- glass/blurred topbar; "RemoteTerm" brand in Aldrich uppercase;
- sidebar section labels in Aldrich uppercase; conversation list legible;
- conversation header is glass with a tricolour chevron before the Aldrich title;
- a channel with outgoing messages shows green `✓` / `✓N` (acked) and an amber `?` (pending), and an incoming message shows the hop badge;
- fonts are actually IBM Plex / Aldrich (not the system fallback) — verify in DevTools Computed → font-family, or by eye against the mockup.

- [ ] **Step 3: Prove isolation**

Switch to **Original** and to **Windows 95**. Confirm (screenshot) the stripe is gone, the topbar/headers are back to stock, and the message indicators are muted again — i.e. DarkDutch rules do not leak.

- [ ] **Step 4: Confirm no DMC identity**

Confirm no DutchMeshCore logo, "DUTCH MESHCORE" wordmark, or DMC name appears anywhere in the DarkDutch UI.

- [ ] **Step 5: Report results**

Write up the two independent checks with evidence: (a) `npm run build` + `npx tsc --noEmit` output, (b) the runtime screenshots for DarkDutch and for a second theme. Mark anything unverified explicitly.

- [ ] **Step 6 (optional): Finalize** — only if authorized

If committing is authorized and the branch should be finished, use the `superpowers:finishing-a-development-branch` skill (PR/merge targets `origin`, the fork).

---

## Self-review notes

- **Spec coverage:** fonts (T1), palette+glow+glass+stripe+topbar+conversation-header+Aldrich+bubble borders (T2), registration (T3), stripe DOM (T4), topbar hook (T5), Aldrich section labels (T6), semantic indicators (T7), verification incl. isolation + no-DMC check (T8). All spec sections mapped.
- **Type/selector consistency:** class names used in `themes.css` (`app-statusbar`, `dd-section-label`, `msg-ack`, `msg-ack-pending`, `.conversation-header h2`, `.page-stripe`) match exactly the classes added in T4–T7 and the existing `.conversation-header` (ChatHeader.tsx:165). Theme id `darkdutch` is identical in `themes.css` and `theme.ts`.
- **No placeholders:** every code and command step is concrete.
