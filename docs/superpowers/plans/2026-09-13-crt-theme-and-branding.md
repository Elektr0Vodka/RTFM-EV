# CRT Theme + Branding Customisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a retro CRT theme (green default, amber/white/blue phosphor variants, scanline/glow/curvature/flicker effects, all per-device) and server-side navbar Branding (custom name, hide toggle, custom icon upload).

**Architecture:** CRT is a dedicated `data-theme='crt'` in the existing theme system, kept out of the swatch grid; phosphor colour and effect toggles are per-device `localStorage` attributes stamped on `<html>` and layered in `themes.css`. Branding is three new columns on the single-row `app_settings` table, surfaced through the existing `AppSettings`/`PATCH /settings`/`useAppSettings` pipeline and rendered in the navbar.

**Tech Stack:** React + TypeScript + Tailwind (frontend), Vitest; FastAPI + Pydantic + aiosqlite (backend), pytest. i18n via JSON locales (EN/NL/DE), enforced by eslint + a parity test.

**Spec:** `docs/superpowers/specs/2026-09-13-crt-theme-and-branding-design.md`

**Conventions (project rules):**
- No em dashes in user-visible strings.
- Every new user-facing string needs a `t()` key present in `en.json`, `nl.json`, `de.json`.
- Do NOT commit unless the human explicitly says so. The commit steps below are written for when the human authorises committing; if commits are disabled, do the `git add`/verify but skip `git commit`.
- Run `git status` / `git worktree list` before operating; this is worktree `unruffled-heyrovsky-63a6c8`.

**Backend test command (per project memory — Windows host has pre-existing failures, so run backend tests in the container):**
```bash
docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/<path> -v
```
If the container is unavailable, fall back to `python -m pytest <path> -v` from the repo root and ignore the known pre-existing Windows failures.

**Frontend commands (run from `frontend/`):**
- Test: `npm run test -- <file>`
- Lint: `npm run lint`
- Format check: `npm run format:check` (run `npm run format` to fix)

---

## File Structure

**CRT theme (frontend, per-device):**
- Create `frontend/src/utils/crt.ts` — phosphor + effect state, `applyCrt()`.
- Create `frontend/src/test/crt.test.ts` — unit tests.
- Modify `frontend/src/utils/theme.ts` — call `applyCrt()` from `applyTheme()`.
- Modify `frontend/src/main.tsx` — call `applyCrt()` on boot.
- Modify `frontend/src/themes.css` — CRT base block, phosphor variants, effect overlays.
- Create `frontend/src/components/settings/CrtSettings.tsx` — CRT section UI.
- Create `frontend/src/test/crtSettings.test.tsx` — component test.

**Branding backend (server-side):**
- Create `app/migrations/_082_add_branding.py` — add columns.
- Create `tests/test_migrations/test_migration_082.py` — migration test.
- Modify `tests/test_migrations/conftest.py` — bump `LATEST_SCHEMA_VERSION` to 82.
- Modify `app/models.py` — `AppSettings` brand fields.
- Modify `app/repository/settings.py` — select/parse + `_apply_updates` + `update`.
- Modify `app/routers/settings.py` — `AppSettingsUpdate` fields + handler + icon validation.
- Modify `tests/test_settings_router.py` — branding round-trip + validation tests.

**Branding frontend:**
- Create `frontend/src/utils/brandIcon.ts` — client-side icon validation (mirrors server).
- Create `frontend/src/test/brandIcon.test.ts` — unit test.
- Modify `frontend/src/types.ts` — `AppSettings` + `AppSettingsUpdate` brand fields.
- Create `frontend/src/components/settings/BrandingSettings.tsx` — branding UI.
- Create `frontend/src/test/brandingSettings.test.tsx` — component test.
- Modify `frontend/src/components/settings/SettingsLocalSection.tsx` — rename heading, mount CRT + Branding.
- Modify `frontend/src/components/StatusBar.tsx` — render custom name/icon/hide + props.
- Modify `frontend/src/test/statusBar.test.tsx` — brand rendering tests.
- Modify `frontend/src/components/AppShell.tsx` — extend `statusProps` Pick.
- Modify `frontend/src/App.tsx` — pass brand fields into `statusProps`.

**i18n + docs:**
- Modify `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json` — new keys (added inline in the UI tasks below).
- Modify `CHANGELOG-DMC-EV.md`, `README.md`.

---

## Phase A — CRT theme (frontend, per-device)

### Task 1: CRT preference utility

**Files:**
- Create: `frontend/src/utils/crt.ts`
- Test: `frontend/src/test/crt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/test/crt.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CRT_EFFECTS,
  CRT_PHOSPHORS,
  DEFAULT_CRT_PHOSPHOR,
  applyCrt,
  getCrtEffect,
  getCrtPhosphor,
  setCrtEffect,
  setCrtPhosphor,
} from '../utils/crt';

describe('crt module', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-crt-phosphor');
    for (const e of CRT_EFFECTS) {
      document.documentElement.removeAttribute(`data-crt-${e}`);
    }
  });
  afterEach(() => localStorage.clear());

  it('defaults phosphor to green and effects to on', () => {
    expect(getCrtPhosphor()).toBe(DEFAULT_CRT_PHOSPHOR);
    expect(DEFAULT_CRT_PHOSPHOR).toBe('green');
    for (const e of CRT_EFFECTS) {
      expect(getCrtEffect(e)).toBe(true);
    }
  });

  it('applyCrt stamps phosphor and effect attributes on <html>', () => {
    setCrtPhosphor('amber');
    setCrtEffect('flicker', false);
    applyCrt();
    const root = document.documentElement;
    expect(root.getAttribute('data-crt-phosphor')).toBe('amber');
    expect(root.getAttribute('data-crt-flicker')).toBe('0');
    expect(root.getAttribute('data-crt-scanlines')).toBe('1');
  });

  it('ignores an unknown stored phosphor and falls back to green', () => {
    localStorage.setItem('remoteterm-crt-phosphor', 'chartreuse');
    expect(getCrtPhosphor()).toBe('green');
  });

  it('exposes exactly the four phosphors and four effects', () => {
    expect([...CRT_PHOSPHORS]).toEqual(['green', 'amber', 'white', 'blue']);
    expect([...CRT_EFFECTS]).toEqual(['scanlines', 'glow', 'curvature', 'flicker']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/test/crt.test.ts`
Expected: FAIL (cannot resolve `../utils/crt`).

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/utils/crt.ts

/** Per-device CRT theme preferences (phosphor colour + effect toggles).
 *
 * These are display-only preferences stored in localStorage, mirroring the
 * existing theme selection. They are applied as data attributes on <html> and
 * are visually inert unless data-theme='crt' (themes.css gates on both). */

export const CRT_PHOSPHORS = ['green', 'amber', 'white', 'blue'] as const;
export type CrtPhosphor = (typeof CRT_PHOSPHORS)[number];
export const DEFAULT_CRT_PHOSPHOR: CrtPhosphor = 'green';

export const CRT_EFFECTS = ['scanlines', 'glow', 'curvature', 'flicker'] as const;
export type CrtEffect = (typeof CRT_EFFECTS)[number];

const PHOSPHOR_KEY = 'remoteterm-crt-phosphor';
const effectKey = (effect: CrtEffect): string => `remoteterm-crt-${effect}`;

export function getCrtPhosphor(): CrtPhosphor {
  try {
    const stored = localStorage.getItem(PHOSPHOR_KEY);
    if (stored && (CRT_PHOSPHORS as readonly string[]).includes(stored)) {
      return stored as CrtPhosphor;
    }
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_CRT_PHOSPHOR;
}

export function setCrtPhosphor(phosphor: CrtPhosphor): void {
  try {
    localStorage.setItem(PHOSPHOR_KEY, phosphor);
  } catch {
    // ignore
  }
  applyCrt();
}

/** Effects default ON: only an explicit '0' disables them. */
export function getCrtEffect(effect: CrtEffect): boolean {
  try {
    return localStorage.getItem(effectKey(effect)) !== '0';
  } catch {
    return true;
  }
}

export function setCrtEffect(effect: CrtEffect, enabled: boolean): void {
  try {
    localStorage.setItem(effectKey(effect), enabled ? '1' : '0');
  } catch {
    // ignore
  }
  applyCrt();
}

/** Stamp phosphor + effect state onto <html> as data attributes. */
export function applyCrt(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-crt-phosphor', getCrtPhosphor());
  for (const effect of CRT_EFFECTS) {
    root.setAttribute(`data-crt-${effect}`, getCrtEffect(effect) ? '1' : '0');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- src/test/crt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/crt.ts frontend/src/test/crt.test.ts
git commit -m "feat(crt): add per-device CRT phosphor and effect preference util"
```

---

### Task 2: Wire applyCrt into theme bootstrap

**Files:**
- Modify: `frontend/src/utils/theme.ts`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Import and call applyCrt from applyTheme**

In `frontend/src/utils/theme.ts`, add the import at the top (after the existing top-of-file, before `export interface Theme`):

```ts
import { applyCrt } from './crt';
```

Then inside `applyTheme()`, immediately after the block that sets/clears `document.documentElement.dataset.theme` (the `if (effective === 'original') { ... } else { ... }` block) and before the PWA meta-tag update, add:

```ts
  // Keep CRT phosphor/effect attributes in sync so they are present the moment
  // the CRT theme becomes active (and harmless otherwise).
  applyCrt();
```

- [ ] **Step 2: Call applyCrt on boot**

In `frontend/src/main.tsx`, extend the theme import (line 8) and add a call after `applyTheme(getSavedTheme());` (line 19):

Change:
```ts
import { getSavedTheme, applyTheme, initFollowOSListener } from './utils/theme';
```
to:
```ts
import { getSavedTheme, applyTheme, initFollowOSListener } from './utils/theme';
import { applyCrt } from './utils/crt';
```

After `applyTheme(getSavedTheme());` add:
```ts
applyCrt();
```
(`applyTheme` already calls `applyCrt`, but this guards the case where the initial theme path changes; it is idempotent.)

- [ ] **Step 3: Verify existing theme tests still pass**

Run: `npm run test -- src/test/theme.test.ts src/test/crt.test.ts`
Expected: PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/theme.ts frontend/src/main.tsx
git commit -m "feat(crt): stamp CRT attributes from theme bootstrap"
```

---

### Task 3: CRT CSS (base + phosphor variants + effects)

**Files:**
- Modify: `frontend/src/themes.css` (append a new CRT section at the end of the file)

This task is CSS-only; verification is visual (Task 5 mounts the toggle) plus a lint/build check.

- [ ] **Step 1: Append the CRT block**

Append to the end of `frontend/src/themes.css`:

```css
/* ── CRT (retro phosphor monitor) ──────────────────────────────
   One data-theme, four phosphor variants (data-crt-phosphor), and four
   individually-toggleable effects (data-crt-<effect>='0' disables). Green is
   the default phosphor (defined in the base block). */
:root[data-theme='crt'] {
  --background: 120 30% 3%;
  --foreground: 120 100% 76%;
  --card: 120 24% 5%;
  --card-foreground: 120 100% 76%;
  --popover: 120 24% 6%;
  --popover-foreground: 120 100% 76%;
  --primary: 123 100% 56%;
  --primary-foreground: 120 60% 6%;
  --secondary: 120 18% 10%;
  --secondary-foreground: 120 80% 72%;
  --muted: 120 12% 9%;
  --muted-foreground: 120 40% 52%;
  --accent: 120 20% 12%;
  --accent-foreground: 120 100% 76%;
  --destructive: 8 100% 60%;
  --destructive-foreground: 8 100% 8%;
  --border: 120 40% 16%;
  --input: 120 40% 16%;
  --ring: 123 100% 56%;
  --radius: 0px;
  --msg-outgoing: 120 30% 8%;
  --msg-incoming: 120 14% 6%;
  --status-connected: 123 100% 50%;
  --status-disconnected: 120 10% 34%;
  --warning: 45 100% 55%;
  --warning-foreground: 45 100% 8%;
  --success: 123 100% 46%;
  --success-foreground: 123 100% 6%;
  --info: 180 100% 50%;
  --info-foreground: 180 100% 6%;
  --region-override: 300 100% 68%;
  --favorite: 55 100% 55%;
  --console: 123 100% 56%;
  --console-command: 123 100% 68%;
  --console-bg: 120 40% 2%;
  --toast-error: 8 50% 12%;
  --toast-error-foreground: 8 90% 74%;
  --toast-error-border: 8 45% 20%;
  --code-editor-bg: 120 30% 4%;
  --font-mono: 'Courier New', 'Lucida Console', monospace;
  --scrollbar: 120 24% 14%;
  --scrollbar-hover: 120 34% 20%;
  --overlay: 0 0% 0%;
  /* Phosphor tint reused by the effect overlays (glow, scanline blend). */
  --crt-phosphor: 123 100% 56%;
}

/* Amber (P3) */
:root[data-theme='crt'][data-crt-phosphor='amber'] {
  --background: 30 40% 4%;
  --foreground: 38 100% 62%;
  --card: 30 30% 6%;
  --card-foreground: 38 100% 62%;
  --popover: 30 30% 7%;
  --popover-foreground: 38 100% 62%;
  --primary: 38 100% 56%;
  --primary-foreground: 30 60% 6%;
  --secondary-foreground: 38 90% 60%;
  --muted-foreground: 34 50% 50%;
  --accent-foreground: 38 100% 62%;
  --border: 34 55% 18%;
  --input: 34 55% 18%;
  --ring: 38 100% 56%;
  --status-connected: 38 100% 52%;
  --console: 38 100% 56%;
  --console-command: 38 100% 70%;
  --crt-phosphor: 38 100% 56%;
}

/* White / grey (P4) */
:root[data-theme='crt'][data-crt-phosphor='white'] {
  --background: 0 0% 3%;
  --foreground: 0 0% 86%;
  --card: 0 0% 6%;
  --card-foreground: 0 0% 86%;
  --popover: 0 0% 7%;
  --popover-foreground: 0 0% 86%;
  --primary: 0 0% 92%;
  --primary-foreground: 0 0% 8%;
  --secondary-foreground: 0 0% 78%;
  --muted-foreground: 0 0% 52%;
  --accent-foreground: 0 0% 86%;
  --border: 0 0% 22%;
  --input: 0 0% 22%;
  --ring: 0 0% 80%;
  --status-connected: 0 0% 82%;
  --console: 0 0% 90%;
  --console-command: 0 0% 100%;
  --crt-phosphor: 0 0% 88%;
}

/* Blue (C64) */
:root[data-theme='crt'][data-crt-phosphor='blue'] {
  --background: 244 55% 12%;
  --foreground: 240 100% 80%;
  --card: 244 45% 15%;
  --card-foreground: 240 100% 80%;
  --popover: 244 45% 16%;
  --popover-foreground: 240 100% 80%;
  --primary: 240 100% 76%;
  --primary-foreground: 244 60% 10%;
  --secondary: 244 40% 20%;
  --secondary-foreground: 240 90% 78%;
  --muted: 244 30% 20%;
  --muted-foreground: 240 40% 62%;
  --accent: 244 40% 24%;
  --accent-foreground: 240 100% 80%;
  --border: 240 45% 30%;
  --input: 240 45% 30%;
  --ring: 240 100% 76%;
  --msg-outgoing: 244 45% 20%;
  --msg-incoming: 244 40% 16%;
  --status-connected: 240 100% 74%;
  --console: 240 100% 78%;
  --console-command: 240 100% 88%;
  --crt-phosphor: 240 100% 78%;
}

/* Body background + base mono feel */
:root[data-theme='crt'] body {
  background-color: hsl(var(--background));
}

/* Phosphor glow on text (effect: glow) */
:root[data-theme='crt']:not([data-crt-glow='0']) body {
  text-shadow: 0 0 2px hsl(var(--crt-phosphor) / 0.55);
}

/* Scanlines: fixed full-viewport overlay (effect: scanlines) */
:root[data-theme='crt']:not([data-crt-scanlines='0']) body::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 9998;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0px,
    rgba(0, 0, 0, 0) 2px,
    rgba(0, 0, 0, 0.28) 3px,
    rgba(0, 0, 0, 0.28) 3px
  );
  background-size: 100% 3px;
}

/* Curvature / vignette: darkened edges (effect: curvature) */
:root[data-theme='crt']:not([data-crt-curvature='0']) body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 9997;
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    rgba(0, 0, 0, 0) 55%,
    rgba(0, 0, 0, 0.55) 100%
  );
}

/* Flicker: animate the scanline overlay opacity (effect: flicker).
   Disabled for users who prefer reduced motion. */
@media (prefers-reduced-motion: no-preference) {
  :root[data-theme='crt']:not([data-crt-flicker='0']):not([data-crt-scanlines='0']) body::after {
    animation: crt-flicker 0.18s steps(2, end) infinite;
  }
}

@keyframes crt-flicker {
  0% {
    opacity: 0.92;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.95;
  }
}
```

- [ ] **Step 2: Verify the build compiles and lints**

Run (from `frontend/`): `npm run lint`
Expected: no new errors. (CSS is not linted by eslint, but this catches accidental TS/JSX breakage from adjacent edits.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/themes.css
git commit -m "feat(crt): add CRT base theme, phosphor variants, and effect overlays"
```

---

### Task 4: CRT settings section component

**Files:**
- Create: `frontend/src/components/settings/CrtSettings.tsx`
- Create: `frontend/src/test/crtSettings.test.tsx`
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

- [ ] **Step 1: Add i18n keys (all three locales)**

Add these keys to `en.json`, `nl.json`, `de.json` (place them near the other `settings_*` keys; keep JSON valid — add commas). Values:

`en.json`:
```json
  "settings_crt_heading": "CRT mode",
  "settings_crt_enable": "Enable CRT theme",
  "settings_crt_description": "A retro phosphor-monitor look. Pick a phosphor colour and which screen effects to show.",
  "settings_crt_phosphor_legend": "Phosphor colour",
  "settings_crt_phosphor_green": "Green",
  "settings_crt_phosphor_amber": "Amber",
  "settings_crt_phosphor_white": "White",
  "settings_crt_phosphor_blue": "Blue",
  "settings_crt_effects_legend": "Screen effects",
  "settings_crt_effect_scanlines": "Scanlines",
  "settings_crt_effect_glow": "Phosphor glow",
  "settings_crt_effect_curvature": "Screen curvature",
  "settings_crt_effect_flicker": "Flicker",
```

`nl.json`:
```json
  "settings_crt_heading": "CRT-modus",
  "settings_crt_enable": "CRT-thema inschakelen",
  "settings_crt_description": "Een retro fosformonitor-look. Kies een fosforkleur en welke schermeffecten je toont.",
  "settings_crt_phosphor_legend": "Fosforkleur",
  "settings_crt_phosphor_green": "Groen",
  "settings_crt_phosphor_amber": "Amber",
  "settings_crt_phosphor_white": "Wit",
  "settings_crt_phosphor_blue": "Blauw",
  "settings_crt_effects_legend": "Schermeffecten",
  "settings_crt_effect_scanlines": "Scanlijnen",
  "settings_crt_effect_glow": "Fosforgloed",
  "settings_crt_effect_curvature": "Schermkromming",
  "settings_crt_effect_flicker": "Flikkering",
```

`de.json`:
```json
  "settings_crt_heading": "CRT-Modus",
  "settings_crt_enable": "CRT-Thema aktivieren",
  "settings_crt_description": "Ein Retro-Phosphormonitor-Look. Waehle eine Phosphorfarbe und welche Bildschirmeffekte angezeigt werden.",
  "settings_crt_phosphor_legend": "Phosphorfarbe",
  "settings_crt_phosphor_green": "Gruen",
  "settings_crt_phosphor_amber": "Bernstein",
  "settings_crt_phosphor_white": "Weiss",
  "settings_crt_phosphor_blue": "Blau",
  "settings_crt_effects_legend": "Bildschirmeffekte",
  "settings_crt_effect_scanlines": "Scanlinien",
  "settings_crt_effect_glow": "Phosphorglühen",
  "settings_crt_effect_curvature": "Bildschirmkruemmung",
  "settings_crt_effect_flicker": "Flackern",
```

- [ ] **Step 2: Write the failing component test**

```tsx
// frontend/src/test/crtSettings.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CrtSettings } from '../components/settings/CrtSettings';
import { I18nProvider } from '../i18n/I18nProvider';

function renderCrt() {
  return render(
    <I18nProvider>
      <CrtSettings />
    </I18nProvider>
  );
}

describe('CrtSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('enabling CRT sets the crt theme', () => {
    renderCrt();
    const toggle = screen.getByLabelText(/enable crt/i);
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('crt');
    expect(localStorage.getItem('remoteterm-theme')).toBe('crt');
  });

  it('choosing amber persists the phosphor and stamps the attribute', () => {
    renderCrt();
    fireEvent.click(screen.getByLabelText(/enable crt/i));
    fireEvent.click(screen.getByLabelText(/amber/i));
    expect(localStorage.getItem('remoteterm-crt-phosphor')).toBe('amber');
    expect(document.documentElement.getAttribute('data-crt-phosphor')).toBe('amber');
  });

  it('disabling an effect writes 0', () => {
    renderCrt();
    fireEvent.click(screen.getByLabelText(/enable crt/i));
    fireEvent.click(screen.getByLabelText(/flicker/i));
    expect(localStorage.getItem('remoteterm-crt-flicker')).toBe('0');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- src/test/crtSettings.test.tsx`
Expected: FAIL (cannot resolve `CrtSettings`).

- [ ] **Step 4: Write the component**

```tsx
// frontend/src/components/settings/CrtSettings.tsx
import { useState } from 'react';
import { useT } from '../../i18n';
import { applyTheme, getSavedTheme } from '../../utils/theme';
import {
  CRT_EFFECTS,
  CRT_PHOSPHORS,
  type CrtEffect,
  type CrtPhosphor,
  getCrtEffect,
  getCrtPhosphor,
  setCrtEffect,
  setCrtPhosphor,
} from '../../utils/crt';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';

const CRT_THEME_ID = 'crt';

/** Preview swatch colour per phosphor (approximate; for the picker only). */
const PHOSPHOR_SWATCH: Record<CrtPhosphor, string> = {
  green: '#2bff5a',
  amber: '#ffb028',
  white: '#e0e0e0',
  blue: '#7b7bff',
};

export function CrtSettings() {
  const t = useT();
  const [active, setActive] = useState(() => getSavedTheme() === CRT_THEME_ID);
  const [phosphor, setPhosphor] = useState<CrtPhosphor>(getCrtPhosphor);
  const [effects, setEffects] = useState<Record<CrtEffect, boolean>>(() => {
    const initial = {} as Record<CrtEffect, boolean>;
    for (const e of CRT_EFFECTS) initial[e] = getCrtEffect(e);
    return initial;
  });

  const phosphorLabel: Record<CrtPhosphor, string> = {
    green: t('settings_crt_phosphor_green'),
    amber: t('settings_crt_phosphor_amber'),
    white: t('settings_crt_phosphor_white'),
    blue: t('settings_crt_phosphor_blue'),
  };
  const effectLabel: Record<CrtEffect, string> = {
    scanlines: t('settings_crt_effect_scanlines'),
    glow: t('settings_crt_effect_glow'),
    curvature: t('settings_crt_effect_curvature'),
    flicker: t('settings_crt_effect_flicker'),
  };

  const handleToggleActive = (enabled: boolean) => {
    setActive(enabled);
    // Enabling selects the CRT theme; disabling reverts to the default theme.
    applyTheme(enabled ? CRT_THEME_ID : 'original');
  };

  const handlePhosphor = (next: CrtPhosphor) => {
    setPhosphor(next);
    setCrtPhosphor(next);
  };

  const handleEffect = (effect: CrtEffect, enabled: boolean) => {
    setEffects((prev) => ({ ...prev, [effect]: enabled }));
    setCrtEffect(effect, enabled);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_crt_heading')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_crt_description')}</p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
        <Checkbox
          id="crt-enable"
          checked={active}
          onCheckedChange={(c) => handleToggleActive(c === true)}
          className="mt-0.5"
        />
        <Label htmlFor="crt-enable">{t('settings_crt_enable')}</Label>
      </div>

      {active && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-[0.8125rem] font-medium">
              {t('settings_crt_phosphor_legend')}
            </legend>
            <div className="flex flex-wrap gap-2">
              {CRT_PHOSPHORS.map((p) => (
                <label
                  key={p}
                  className={
                    'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer border transition-colors ' +
                    (phosphor === p
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent hover:bg-accent/50')
                  }
                >
                  <input
                    type="radio"
                    name="crt-phosphor"
                    value={p}
                    checked={phosphor === p}
                    onChange={() => handlePhosphor(p)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="w-3 h-3 rounded-full ring-1 ring-border/40"
                    style={{ backgroundColor: PHOSPHOR_SWATCH[p] }}
                  />
                  <span className="text-xs whitespace-nowrap">{phosphorLabel[p]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[0.8125rem] font-medium">
              {t('settings_crt_effects_legend')}
            </legend>
            <div className="space-y-2">
              {CRT_EFFECTS.map((e) => (
                <div key={e} className="flex items-center gap-3 rounded-md border border-border/60 p-3">
                  <Checkbox
                    id={`crt-effect-${e}`}
                    checked={effects[e]}
                    onCheckedChange={(c) => handleEffect(e, c === true)}
                  />
                  <Label htmlFor={`crt-effect-${e}`}>{effectLabel[e]}</Label>
                </div>
              ))}
            </div>
          </fieldset>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/test/crtSettings.test.tsx`
Expected: PASS (3 tests). If the `Checkbox`/`Label` import paths differ, match the imports already used in `SettingsLocalSection.tsx` (`../ui/checkbox`, `../ui/label`).

- [ ] **Step 6: Lint + format**

Run: `npm run lint && npm run format:check`
Expected: clean (run `npm run format` if format:check fails).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/settings/CrtSettings.tsx frontend/src/test/crtSettings.test.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(crt): add CRT settings section (enable, phosphor, effects)"
```

---

## Phase B — Customisation panel rename + CRT mount

### Task 5: Rename heading and mount CRT section

**Files:**
- Modify: `frontend/src/components/settings/SettingsLocalSection.tsx`
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

- [ ] **Step 1: Add the new heading key (all three locales)**

Add to each locale (near the existing `settings_color_scheme`):

`en.json`: `"settings_customisation": "Customisation",`
`nl.json`: `"settings_customisation": "Personalisatie",`
`de.json`: `"settings_customisation": "Personalisierung",`

(Leave `settings_color_scheme` as-is; it still titles the navbar quick-theme dialog in `StatusBar.tsx:319`.)

- [ ] **Step 2: Rename the heading and mount CRT**

In `frontend/src/components/settings/SettingsLocalSection.tsx`:

Add the import near the other settings imports (after the `ThemeSelector` import on line 20):
```ts
import { CrtSettings } from './CrtSettings';
```

Replace the block at lines 301-305:
```tsx
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_color_scheme')}</h3>
        <ThemeSelector />
        <ThemePreview className="mt-6" />
      </div>
```
with:
```tsx
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_customisation')}</h3>
        <ThemeSelector />
        <ThemePreview className="mt-6" />
      </div>

      <Separator />

      <CrtSettings />
```

- [ ] **Step 3: Verify the settings render test still passes**

Run: `npm run test -- src/test/settingsModal.test.tsx`
Expected: PASS. If a test asserts the old "Color Scheme" heading text, update that assertion to "Customisation".

- [ ] **Step 4: Lint + commit**

```bash
npm run lint
git add frontend/src/components/settings/SettingsLocalSection.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(customisation): rename theme block to Customisation and mount CRT section"
```

---

## Phase C — Branding backend (server-side)

### Task 6: Migration _082 (branding columns)

**Files:**
- Create: `app/migrations/_082_add_branding.py`
- Create: `tests/test_migrations/test_migration_082.py`
- Modify: `tests/test_migrations/conftest.py`

- [ ] **Step 1: Bump LATEST_SCHEMA_VERSION**

In `tests/test_migrations/conftest.py`, change:
```python
LATEST_SCHEMA_VERSION = 81
```
to:
```python
LATEST_SCHEMA_VERSION = 82
```

- [ ] **Step 2: Write the failing migration test**

```python
# tests/test_migrations/test_migration_082.py
"""Tests for database migration 082."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration082:
    """Test migration 082: add app_settings branding columns."""

    @pytest.mark.asyncio
    async def test_adds_branding_columns_with_defaults(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 81)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 81
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute(
                "SELECT brand_name, brand_hidden, brand_icon FROM app_settings WHERE id = 1"
            )
            row = await cursor.fetchone()
            assert row["brand_name"] == ""
            assert row["brand_hidden"] == 0
            assert row["brand_icon"] == ""
        finally:
            await conn.close()
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_migrations/test_migration_082.py -v`
Expected: FAIL (no such column / module not found for `_082`).

- [ ] **Step 4: Write the migration**

```python
# app/migrations/_082_add_branding.py
import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add navbar branding columns to ``app_settings``.

    ``brand_name`` overrides the "RemoteTerm" wordmark, ``brand_hidden`` hides
    the wordmark text, ``brand_icon`` is a data-URL logo (empty = built-in SVG).
    Idempotent: skips columns that already exist.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" not in existing_tables:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    if "brand_name" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN brand_name TEXT NOT NULL DEFAULT ''"
        )
    if "brand_hidden" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN brand_hidden INTEGER NOT NULL DEFAULT 0"
        )
    if "brand_icon" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN brand_icon TEXT NOT NULL DEFAULT ''"
        )

    await conn.commit()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_migrations/test_migration_082.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/migrations/_082_add_branding.py tests/test_migrations/test_migration_082.py tests/test_migrations/conftest.py
git commit -m "feat(branding): add migration _082 for app_settings branding columns"
```

---

### Task 7: AppSettings model brand fields

**Files:**
- Modify: `app/models.py` (inside `class AppSettings`, starting line 1100)

- [ ] **Step 1: Add the fields**

In `app/models.py`, inside `class AppSettings`, add these three fields (place them after the last existing field in the class, keeping the same style):

```python
    brand_name: str = Field(
        default="",
        description="Custom navbar wordmark; empty falls back to the built-in 'RemoteTerm'",
    )
    brand_hidden: bool = Field(
        default=False,
        description="Hide the navbar wordmark text (the icon still shows)",
    )
    brand_icon: str = Field(
        default="",
        description="Custom navbar icon as a data URL; empty falls back to the built-in SVG",
    )
```

- [ ] **Step 2: Verify the model imports/instantiates**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -c "from app.models import AppSettings; s=AppSettings(); print(s.brand_name, s.brand_hidden, s.brand_icon)"`
Expected output: ` False ` (empty name, False, empty icon).

- [ ] **Step 3: Commit**

```bash
git add app/models.py
git commit -m "feat(branding): add brand fields to AppSettings model"
```

---

### Task 8: Repository read/write for brand fields

**Files:**
- Modify: `app/repository/settings.py`

- [ ] **Step 1: Add columns to the SELECT in `_get_in_conn`**

In `_get_in_conn` (the big `SELECT ... FROM app_settings WHERE id = 1`), append the three columns. Change the tail of the column list (currently ending `external_map_sync_interval_hours`) so it reads:

```python
                   external_map_enabled, external_map_sync_url,
                   external_map_sync_interval_hours,
                   brand_name, brand_hidden, brand_icon
            FROM app_settings WHERE id = 1
```

- [ ] **Step 2: Parse the columns before the `return AppSettings(...)`**

Just above the `return AppSettings(` statement, add:

```python
        # Branding (migration _082). Guard against older/partial rows.
        try:
            brand_name = row["brand_name"] or ""
        except (KeyError, TypeError):
            brand_name = ""
        try:
            brand_hidden = bool(row["brand_hidden"])
        except (KeyError, TypeError):
            brand_hidden = False
        try:
            brand_icon = row["brand_icon"] or ""
        except (KeyError, TypeError):
            brand_icon = ""
```

Then add these to the `AppSettings(...)` constructor call (before the closing `)`):

```python
            brand_name=brand_name,
            brand_hidden=brand_hidden,
            brand_icon=brand_icon,
```

- [ ] **Step 3: Add params to `_apply_updates`**

In `_apply_updates`, add three keyword params to the signature (after `external_map_sync_interval_hours: int | None = None,`):

```python
        brand_name: str | None = None,
        brand_hidden: bool | None = None,
        brand_icon: str | None = None,
```

And add the corresponding update clauses (after the `external_map_sync_interval_hours` block):

```python
        if brand_name is not None:
            updates.append("brand_name = ?")
            params.append(brand_name)

        if brand_hidden is not None:
            updates.append("brand_hidden = ?")
            params.append(1 if brand_hidden else 0)

        if brand_icon is not None:
            updates.append("brand_icon = ?")
            params.append(brand_icon)
```

- [ ] **Step 4: Thread params through `update`**

In the `update` staticmethod, add the same three params to its signature (after `external_map_sync_interval_hours: int | None = None,`):

```python
        brand_name: str | None = None,
        brand_hidden: bool | None = None,
        brand_icon: str | None = None,
```

And pass them into the `_apply_updates(conn, ...)` call (after `external_map_sync_interval_hours=external_map_sync_interval_hours,`):

```python
                brand_name=brand_name,
                brand_hidden=brand_hidden,
                brand_icon=brand_icon,
```

- [ ] **Step 5: Verify round-trip via repository**

Run:
```bash
docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_settings_router.py -v -k "empty_patch or forwards_only"
```
Expected: PASS (existing tests still green; confirms the repo still loads/saves).

- [ ] **Step 6: Commit**

```bash
git add app/repository/settings.py
git commit -m "feat(branding): persist brand fields in AppSettingsRepository"
```

---

### Task 9: Router update fields + icon validation

**Files:**
- Modify: `app/routers/settings.py`
- Modify: `tests/test_settings_router.py`

- [ ] **Step 1: Write the failing router tests**

Add to `tests/test_settings_router.py` inside `class TestUpdateSettings` (uses the existing `test_db` fixture):

```python
    @pytest.mark.asyncio
    async def test_brand_name_and_hidden_round_trip(self, test_db):
        result = await update_settings(
            AppSettingsUpdate(brand_name="  MeshHQ  ", brand_hidden=True)
        )
        assert result.brand_name == "MeshHQ"  # trimmed
        assert result.brand_hidden is True

    @pytest.mark.asyncio
    async def test_brand_name_truncated_to_cap(self, test_db):
        result = await update_settings(AppSettingsUpdate(brand_name="x" * 200))
        assert len(result.brand_name) == 64

    @pytest.mark.asyncio
    async def test_valid_png_icon_is_stored(self, test_db):
        icon = "data:image/png;base64,iVBORw0KGgo="
        result = await update_settings(AppSettingsUpdate(brand_icon=icon))
        assert result.brand_icon == icon

    @pytest.mark.asyncio
    async def test_empty_icon_clears(self, test_db):
        await update_settings(
            AppSettingsUpdate(brand_icon="data:image/png;base64,iVBORw0KGgo=")
        )
        result = await update_settings(AppSettingsUpdate(brand_icon=""))
        assert result.brand_icon == ""

    @pytest.mark.asyncio
    async def test_disallowed_icon_mime_rejected(self, test_db):
        with pytest.raises(HTTPException) as exc:
            await update_settings(
                AppSettingsUpdate(brand_icon="data:text/html;base64,PHNjcmlwdD4=")
            )
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_oversized_icon_rejected(self, test_db):
        big = "data:image/png;base64," + ("A" * 131073)
        with pytest.raises(HTTPException) as exc:
            await update_settings(AppSettingsUpdate(brand_icon=big))
        assert exc.value.status_code == 400
```

- [ ] **Step 2: Run to verify failure**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_settings_router.py -v -k brand`
Expected: FAIL (fields not on `AppSettingsUpdate`).

- [ ] **Step 3: Add fields + validation to the router**

In `app/routers/settings.py`:

Add a module-level constant and helper near the top (after `MAX_TRACKED_TELEMETRY_CONTACTS = 8`):

```python
MAX_BRAND_NAME_LEN = 64
MAX_BRAND_ICON_BYTES = 131072  # 128 KB, encoded data-URL length
ALLOWED_BRAND_ICON_MIMES = (
    "image/png",
    "image/svg+xml",
    "image/x-icon",
    "image/vnd.microsoft.icon",
    "image/jpeg",
)


def _validate_brand_icon(value: str) -> str:
    """Return a cleaned brand-icon data URL, or raise HTTP 400.

    Empty clears the icon. Otherwise the value must be a data URL of an allowed
    image type and within the size cap.
    """
    cleaned = value.strip()
    if not cleaned:
        return ""
    if len(cleaned) > MAX_BRAND_ICON_BYTES:
        raise HTTPException(status_code=400, detail="brand_icon exceeds 128 KB")
    if not cleaned.startswith("data:"):
        raise HTTPException(status_code=400, detail="brand_icon must be a data URL")
    header = cleaned[5 : cleaned.find(",")] if "," in cleaned else ""
    mime = header.split(";", 1)[0].strip().lower()
    if mime not in ALLOWED_BRAND_ICON_MIMES:
        raise HTTPException(
            status_code=400,
            detail="brand_icon must be a PNG, SVG, ICO, or JPEG data URL",
        )
    return cleaned
```

Add the fields to `class AppSettingsUpdate` (after `external_map_sync_interval_hours`):

```python
    brand_name: str | None = Field(
        default=None,
        description="Custom navbar wordmark (empty falls back to 'RemoteTerm')",
    )
    brand_hidden: bool | None = Field(
        default=None,
        description="Hide the navbar wordmark text (icon still shows)",
    )
    brand_icon: str | None = Field(
        default=None,
        description="Custom navbar icon as a data URL (empty falls back to the built-in SVG)",
    )
```

In `update_settings`, add handling (place it alongside the other field blocks, e.g. after the `external_map_*` block and before the `flood_scope` block):

```python
    # Branding
    if update.brand_name is not None:
        kwargs["brand_name"] = update.brand_name.strip()[:MAX_BRAND_NAME_LEN]
    if update.brand_hidden is not None:
        kwargs["brand_hidden"] = update.brand_hidden
    if update.brand_icon is not None:
        kwargs["brand_icon"] = _validate_brand_icon(update.brand_icon)
```

- [ ] **Step 4: Run to verify pass**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_settings_router.py -v -k brand`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full settings router suite (no regressions)**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_settings_router.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/routers/settings.py tests/test_settings_router.py
git commit -m "feat(branding): accept and validate brand fields in PATCH /settings"
```

---

## Phase D — Branding frontend + navbar

### Task 10: Frontend types for brand fields

**Files:**
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Extend `AppSettings`**

In `interface AppSettings` (line 472), add before the closing brace (after `external_map_sync_interval_hours: number;`):

```ts
  brand_name: string;
  brand_hidden: boolean;
  brand_icon: string;
```

- [ ] **Step 2: Extend `AppSettingsUpdate`**

In `interface AppSettingsUpdate` (line 527), add before the closing brace:

```ts
  brand_name?: string;
  brand_hidden?: boolean;
  brand_icon?: string;
```

- [ ] **Step 3: Typecheck**

Run (from `frontend/`): `npm run lint`
Expected: no type errors introduced.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts
git commit -m "feat(branding): add brand fields to frontend AppSettings types"
```

---

### Task 11: Client-side icon validation util

**Files:**
- Create: `frontend/src/utils/brandIcon.ts`
- Create: `frontend/src/test/brandIcon.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/test/brandIcon.test.ts
import { describe, expect, it } from 'vitest';
import { MAX_BRAND_ICON_BYTES, validateBrandIconDataUrl } from '../utils/brandIcon';

describe('validateBrandIconDataUrl', () => {
  it('accepts a small png data url', () => {
    expect(validateBrandIconDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
  });

  it('rejects a non-image mime', () => {
    expect(validateBrandIconDataUrl('data:text/html;base64,PHN2Zz4=')).toBe(
      'settings_branding_icon_type_error'
    );
  });

  it('rejects a non-data url', () => {
    expect(validateBrandIconDataUrl('https://example.com/logo.png')).toBe(
      'settings_branding_icon_type_error'
    );
  });

  it('rejects an oversized icon', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(MAX_BRAND_ICON_BYTES);
    expect(validateBrandIconDataUrl(big)).toBe('settings_branding_icon_size_error');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/test/brandIcon.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the util**

```ts
// frontend/src/utils/brandIcon.ts

/** Client-side brand-icon validation, mirroring the server rules in
 * app/routers/settings.py. Returns an i18n error key, or null when valid. */

export const MAX_BRAND_ICON_BYTES = 131072; // 128 KB
export const ALLOWED_BRAND_ICON_MIMES = [
  'image/png',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/jpeg',
];

export function validateBrandIconDataUrl(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) return null; // empty clears the icon
  if (cleaned.length > MAX_BRAND_ICON_BYTES) return 'settings_branding_icon_size_error';
  if (!cleaned.startsWith('data:')) return 'settings_branding_icon_type_error';
  const comma = cleaned.indexOf(',');
  const header = comma >= 0 ? cleaned.slice(5, comma) : '';
  const mime = header.split(';', 1)[0].trim().toLowerCase();
  if (!ALLOWED_BRAND_ICON_MIMES.includes(mime)) return 'settings_branding_icon_type_error';
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- src/test/brandIcon.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/brandIcon.ts frontend/src/test/brandIcon.test.ts
git commit -m "feat(branding): add client-side brand icon validation util"
```

---

### Task 12: Branding settings component

**Files:**
- Create: `frontend/src/components/settings/BrandingSettings.tsx`
- Create: `frontend/src/test/brandingSettings.test.tsx`
- Modify: `frontend/src/components/settings/SettingsLocalSection.tsx`
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

- [ ] **Step 1: Add i18n keys (all three locales)**

`en.json`:
```json
  "settings_branding_heading": "Branding",
  "settings_branding_description": "Customise the app name and icon shown in the top bar. Shared across all devices connected to this instance.",
  "settings_branding_name_label": "App name",
  "settings_branding_name_placeholder": "RemoteTerm",
  "settings_branding_hide_label": "Hide the name in the top bar",
  "settings_branding_icon_label": "Custom icon",
  "settings_branding_icon_upload": "Upload icon",
  "settings_branding_icon_remove": "Remove icon",
  "settings_branding_icon_hint": "PNG, SVG, ICO, or JPEG, up to 128 KB.",
  "settings_branding_icon_type_error": "Icon must be a PNG, SVG, ICO, or JPEG image.",
  "settings_branding_icon_size_error": "Icon is too large (max 128 KB).",
```

`nl.json`:
```json
  "settings_branding_heading": "Branding",
  "settings_branding_description": "Pas de app-naam en het pictogram in de bovenbalk aan. Gedeeld op alle apparaten die met deze instance verbonden zijn.",
  "settings_branding_name_label": "App-naam",
  "settings_branding_name_placeholder": "RemoteTerm",
  "settings_branding_hide_label": "Naam in de bovenbalk verbergen",
  "settings_branding_icon_label": "Eigen pictogram",
  "settings_branding_icon_upload": "Pictogram uploaden",
  "settings_branding_icon_remove": "Pictogram verwijderen",
  "settings_branding_icon_hint": "PNG, SVG, ICO of JPEG, tot 128 KB.",
  "settings_branding_icon_type_error": "Pictogram moet een PNG, SVG, ICO of JPEG zijn.",
  "settings_branding_icon_size_error": "Pictogram is te groot (max 128 KB).",
```

`de.json`:
```json
  "settings_branding_heading": "Branding",
  "settings_branding_description": "Passe den App-Namen und das Symbol in der oberen Leiste an. Fuer alle mit dieser Instanz verbundenen Geraete gemeinsam.",
  "settings_branding_name_label": "App-Name",
  "settings_branding_name_placeholder": "RemoteTerm",
  "settings_branding_hide_label": "Namen in der oberen Leiste ausblenden",
  "settings_branding_icon_label": "Eigenes Symbol",
  "settings_branding_icon_upload": "Symbol hochladen",
  "settings_branding_icon_remove": "Symbol entfernen",
  "settings_branding_icon_hint": "PNG, SVG, ICO oder JPEG, bis zu 128 KB.",
  "settings_branding_icon_type_error": "Symbol muss ein PNG, SVG, ICO oder JPEG sein.",
  "settings_branding_icon_size_error": "Symbol ist zu gross (max. 128 KB).",
```

- [ ] **Step 2: Write the failing component test**

```tsx
// frontend/src/test/brandingSettings.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BrandingSettings } from '../components/settings/BrandingSettings';
import { I18nProvider } from '../i18n/I18nProvider';
import type { AppSettings } from '../types';

const baseSettings = {
  brand_name: '',
  brand_hidden: false,
  brand_icon: '',
} as unknown as AppSettings;

function renderBranding(onSave = vi.fn()) {
  return render(
    <I18nProvider>
      <BrandingSettings appSettings={baseSettings} onSave={onSave} />
    </I18nProvider>
  );
}

describe('BrandingSettings', () => {
  afterEach(() => cleanup());

  it('saves a new name on change', () => {
    const onSave = vi.fn();
    renderBranding(onSave);
    const input = screen.getByLabelText(/app name/i);
    fireEvent.change(input, { target: { value: 'MeshHQ' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith({ brand_name: 'MeshHQ' });
  });

  it('saves the hide toggle', () => {
    const onSave = vi.fn();
    renderBranding(onSave);
    fireEvent.click(screen.getByLabelText(/hide the name/i));
    expect(onSave).toHaveBeenCalledWith({ brand_hidden: true });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test -- src/test/brandingSettings.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 4: Write the component**

```tsx
// frontend/src/components/settings/BrandingSettings.tsx
import { useRef, useState } from 'react';
import { useT } from '../../i18n';
import type { AppSettings, AppSettingsUpdate } from '../../types';
import { validateBrandIconDataUrl } from '../../utils/brandIcon';
import { toast } from '../ui/sonner';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export function BrandingSettings({
  appSettings,
  onSave,
}: {
  appSettings: AppSettings | null;
  onSave: (update: AppSettingsUpdate) => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(appSettings?.brand_name ?? '');
  const [hidden, setHidden] = useState(appSettings?.brand_hidden ?? false);
  const [icon, setIcon] = useState(appSettings?.brand_icon ?? '');

  const commitName = () => {
    const trimmed = name.trim().slice(0, 64);
    if (trimmed !== (appSettings?.brand_name ?? '')) {
      onSave({ brand_name: trimmed });
    }
  };

  const handleHidden = (next: boolean) => {
    setHidden(next);
    onSave({ brand_hidden: next });
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const errorKey = validateBrandIconDataUrl(dataUrl);
      if (errorKey) {
        toast.error(t(errorKey));
        return;
      }
      setIcon(dataUrl);
      onSave({ brand_icon: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const removeIcon = () => {
    setIcon('');
    onSave({ brand_icon: '' });
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_branding_heading')}
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_branding_description')}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="brand-name">{t('settings_branding_name_label')}</Label>
        <Input
          id="brand-name"
          value={name}
          maxLength={64}
          placeholder={t('settings_branding_name_placeholder')}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitName();
            }
          }}
        />
      </div>

      <div className="flex items-center gap-3 rounded-md border border-border/60 p-3">
        <Checkbox
          id="brand-hidden"
          checked={hidden}
          onCheckedChange={(c) => handleHidden(c === true)}
        />
        <Label htmlFor="brand-hidden">{t('settings_branding_hide_label')}</Label>
      </div>

      <div className="space-y-1.5">
        <Label>{t('settings_branding_icon_label')}</Label>
        <div className="flex items-center gap-3">
          {icon ? (
            <img
              src={icon}
              alt=""
              aria-hidden="true"
              className="h-8 w-8 rounded border border-border object-contain"
            />
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/jpeg"
            className="sr-only"
            aria-label={t('settings_branding_icon_upload')}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            {t('settings_branding_icon_upload')}
          </Button>
          {icon ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={removeIcon}
            >
              {t('settings_branding_icon_remove')}
            </Button>
          ) : null}
        </div>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_branding_icon_hint')}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test -- src/test/brandingSettings.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Mount BrandingSettings in SettingsLocalSection**

`SettingsLocalSection.tsx` currently does not receive `appSettings`/`onSave`. Add them to its props and thread them down.

Add the import (after the `CrtSettings` import from Task 5):
```ts
import { BrandingSettings } from './BrandingSettings';
import type { AppSettings, AppSettingsUpdate } from '../../types';
```

Extend the component props. Change the `SettingsLocalSection` signature:
```tsx
export function SettingsLocalSection({
  onLocalLabelChange,
  contacts,
  channels,
  className,
}: {
  onLocalLabelChange?: (label: LocalLabel) => void;
  contacts?: Contact[];
  channels?: Channel[];
  className?: string;
}) {
```
to:
```tsx
export function SettingsLocalSection({
  onLocalLabelChange,
  contacts,
  channels,
  className,
  appSettings,
  onSaveAppSettings,
}: {
  onLocalLabelChange?: (label: LocalLabel) => void;
  contacts?: Contact[];
  channels?: Channel[];
  className?: string;
  appSettings?: AppSettings | null;
  onSaveAppSettings?: (update: AppSettingsUpdate) => void;
}) {
```

Mount the Branding block right after the `<CrtSettings />` you added in Task 5:
```tsx
      <Separator />

      <BrandingSettings
        appSettings={appSettings ?? null}
        onSave={(update) => onSaveAppSettings?.(update)}
      />
```

- [ ] **Step 7: Pass appSettings/onSave from the caller**

`SettingsLocalSection` is rendered in `frontend/src/components/SettingsModal.tsx:254`. That component already receives `appSettings: AppSettings | null` and `onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>` as props (it passes them to sibling sections), so no further threading is needed.

Change the render (SettingsModal.tsx:254-259) from:
```tsx
            <SettingsLocalSection
              onLocalLabelChange={onLocalLabelChange}
              contacts={contacts}
              channels={channels}
              className={sectionContentClass}
            />
```
to:
```tsx
            <SettingsLocalSection
              onLocalLabelChange={onLocalLabelChange}
              contacts={contacts}
              channels={channels}
              className={sectionContentClass}
              appSettings={appSettings}
              onSaveAppSettings={onSaveAppSettings}
            />
```
Keep the prop names `appSettings` and `onSaveAppSettings` consistent with Step 6.

- [ ] **Step 8: Run tests + lint + format**

Run:
```bash
npm run test -- src/test/brandingSettings.test.tsx src/test/settingsModal.test.tsx
npm run lint
npm run format:check
```
Expected: PASS / clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/settings/BrandingSettings.tsx frontend/src/test/brandingSettings.test.tsx frontend/src/components/settings/SettingsLocalSection.tsx frontend/src/components/SettingsModal.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(branding): add Branding settings section and wire into Customisation"
```

---

### Task 13: Render branding in the navbar

**Files:**
- Modify: `frontend/src/components/StatusBar.tsx`
- Modify: `frontend/src/test/statusBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/test/statusBar.test.tsx` (match the existing render helper/props in that file; `baseHealth` already exists there):

```tsx
  it('renders the default RemoteTerm wordmark when unset', () => {
    render(<StatusBar health={baseHealth} config={null} onSettingsClick={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('RemoteTerm');
  });

  it('renders a custom brand name', () => {
    render(
      <StatusBar
        health={baseHealth}
        config={null}
        onSettingsClick={vi.fn()}
        brandName="MeshHQ"
      />
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('MeshHQ');
  });

  it('hides the wordmark text when brandHidden is set', () => {
    render(
      <StatusBar
        health={baseHealth}
        config={null}
        onSettingsClick={vi.fn()}
        brandName="MeshHQ"
        brandHidden
      />
    );
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('MeshHQ');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/test/statusBar.test.tsx`
Expected: FAIL (props not supported; default heading test may pass but custom ones fail).

- [ ] **Step 3: Add props + rendering**

In `StatusBar.tsx`, extend `interface StatusBarProps`:
```ts
interface StatusBarProps {
  health: HealthStatus | null;
  config: RadioConfig | null;
  settingsMode?: boolean;
  onSettingsClick: () => void;
  onMenuClick?: () => void;
  brandName?: string;
  brandHidden?: boolean;
  brandIcon?: string;
}
```

Destructure them:
```tsx
export function StatusBar({
  health,
  config,
  settingsMode = false,
  onSettingsClick,
  onMenuClick,
  brandName,
  brandHidden = false,
  brandIcon,
}: StatusBarProps) {
```

Replace the `<h1>` block (lines 201-215, including the `eslint-disable`/`enable` comments) with:
```tsx
      {/* eslint-disable i18next/no-literal-string -- "RemoteTerm" is the product name, not UI copy */}
      <h1 className="text-base font-semibold tracking-tight mr-auto text-foreground flex items-center gap-1.5">
        {brandIcon ? (
          <img src={brandIcon} alt="" aria-hidden="true" className="h-4 w-4 shrink-0 object-contain" />
        ) : (
          <svg
            className="h-4 w-4 shrink-0 text-white"
            viewBox="0 0 512 512"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="m455.68 85.902c-31.289 0-56.32 25.031-56.32 56.32 0 11.379 3.4141 21.617 8.5352 30.152l-106.38 135.39c12.516 6.2578 23.895 15.359 32.996 25.602l107.52-136.54c4.5508 1.1367 9.1016 1.707 13.652 1.707 31.289 0 56.32-25.031 56.32-56.32 0-30.719-25.031-56.32-56.32-56.32z" />
            <path d="m256 343.04c-5.6875 0-10.809 0.57031-15.93 2.2773l-106.38-135.96c-9.1016 10.809-20.48 19.344-32.996 25.602l106.38 135.96c-5.1211 8.5352-7.3945 18.203-7.3945 28.445 0 31.289 25.031 56.32 56.32 56.32s56.32-25.031 56.32-56.32c0-31.293-25.031-56.324-56.32-56.324z" />
            <path d="m356.69 114.91c3.9805-13.652 10.238-26.738 19.344-37.547-38.113-13.652-78.508-21.047-120.04-21.047-59.164 0-115.48 14.789-166.12 42.668-9.1016-6.8281-21.051-10.809-33.562-10.809-31.289-0.57031-56.32 25.027-56.32 55.75 0 31.289 25.031 56.32 56.32 56.32 31.289 0 56.32-25.031 56.32-56.32 0-3.4141-0.57031-6.8281-1.1367-9.6719 44.371-23.895 93.297-36.41 144.5-36.41 34.703 0 68.836 5.6914 100.69 17.066z" />
          </svg>
        )}
        {!brandHidden && (brandName?.trim() ? brandName : 'RemoteTerm')}
      </h1>
      {/* eslint-enable i18next/no-literal-string */}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- src/test/statusBar.test.tsx`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/StatusBar.tsx frontend/src/test/statusBar.test.tsx
git commit -m "feat(branding): render custom name/icon/hide in the navbar"
```

---

### Task 14: Thread brand fields into the navbar

**Files:**
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Extend the AppShell statusProps type**

In `AppShell.tsx`, change (line 72):
```tsx
  statusProps: Pick<ComponentProps<typeof StatusBar>, 'health' | 'config'>;
```
to:
```tsx
  statusProps: Pick<
    ComponentProps<typeof StatusBar>,
    'health' | 'config' | 'brandName' | 'brandHidden' | 'brandIcon'
  >;
```

- [ ] **Step 2: Pass the props through in AppShell**

In the `<StatusBar ... />` render (around line 257), add the three props:
```tsx
      <StatusBar
        health={statusProps.health}
        config={statusProps.config}
        brandName={statusProps.brandName}
        brandHidden={statusProps.brandHidden}
        brandIcon={statusProps.brandIcon}
        settingsMode={showSettings}
        onSettingsClick={onToggleSettingsView}
        onMenuClick={showSettings ? undefined : () => onSidebarOpenChange(true)}
      />
```

- [ ] **Step 3: Populate statusProps from appSettings in App.tsx**

In `App.tsx`, change the `statusProps` object (lines 623-626):
```tsx
  const statusProps = {
    health,
    config,
  };
```
to:
```tsx
  const statusProps = {
    health,
    config,
    brandName: appSettings?.brand_name || undefined,
    brandHidden: appSettings?.brand_hidden ?? false,
    brandIcon: appSettings?.brand_icon || undefined,
  };
```

- [ ] **Step 4: Typecheck + run the appShell/statusBar tests**

Run:
```bash
npm run lint
npm run test -- src/test/statusBar.test.tsx
```
Expected: clean / PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AppShell.tsx frontend/src/App.tsx
git commit -m "feat(branding): thread brand settings from app state into the navbar"
```

---

## Phase E — i18n parity, full suites, docs

### Task 15: i18n parity + full test suites

**Files:** none (verification only; fix any gaps inline)

- [ ] **Step 1: Run the i18n parity test**

Run: `npm run test -- src/test/i18nParity.test.ts`
Expected: PASS. If it fails, a key is missing from one locale; add the missing key (use the English value as a placeholder translation only if you cannot translate, but prefer the NL/DE values given above).

- [ ] **Step 2: Run the full frontend suite**

Run (from `frontend/`): `npm run test`
Expected: PASS. Investigate and fix any regressions before continuing.

- [ ] **Step 3: Lint + format check**

Run: `npm run lint && npm run format:check`
Expected: clean.

- [ ] **Step 4: Run the full backend suite (container)**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests -q`
Expected: PASS (allowing for pre-existing, unrelated failures noted in project memory; the branding + migration tests must pass).

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "test(crt,branding): fix i18n parity and suite regressions"
```
(Skip if nothing changed.)

---

### Task 16: Documentation

**Files:**
- Modify: `CHANGELOG-DMC-EV.md`
- Modify: `README.md`

- [ ] **Step 1: Add a changelog entry**

Open `CHANGELOG-DMC-EV.md`, read the existing format (grouped by area), and add an entry under the current/unreleased section. Content:

```markdown
### Added
- CRT theme with green (default), amber, white, and blue phosphor variants, plus
  toggleable scanline, phosphor-glow, curvature, and flicker effects (per-device;
  flicker respects prefers-reduced-motion). Lives in a dedicated CRT section under
  the renamed "Customisation" settings block.
- Branding: customise the navbar name, hide it, and upload a custom icon.
  Stored server-side (shared across devices); icon capped at 128 KB
  (PNG/SVG/ICO/JPEG). Migration _082.
```
Adjust headings to match the file's existing structure.

- [ ] **Step 2: Update README feature list**

In `README.md`, find where themes / customisation / appearance features are listed and add a short line for the CRT theme and Branding customisation, matching the surrounding style. If there is no such list, add a brief note under the most relevant existing section (e.g. UI/appearance).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG-DMC-EV.md README.md
git commit -m "docs: document CRT theme and branding customisation"
```

---

## Manual runtime verification (do before claiming done)

The project rule "Never claim it works without proof" requires observed runtime behaviour, not just green tests. After the tasks above, verify against the live container instance (rtfm-ev-local on :8000, rebuilt from this branch):

- [ ] Open Settings > the "Customisation" section renders with Theme grid, CRT section, and Branding block.
- [ ] Enable CRT: navbar/app switches to green phosphor with scanlines visible.
- [ ] Switch phosphor to amber/white/blue: colours change; each effect toggle visibly turns its effect on/off; disabling flicker stops animation.
- [ ] Select a normal grid theme: CRT deactivates (mutual exclusion) and the CRT section shows disabled state.
- [ ] Set a custom brand name: navbar wordmark updates. Toggle hide: text disappears, icon stays. Upload a PNG: navbar icon updates. Reload the page and confirm branding persists (served from the backend). Open in a second browser and confirm branding is shared.
- [ ] Try uploading a >128 KB file or a .txt: a toast error appears and nothing is saved.

Record the two independent checks (e.g. "full frontend suite PASS" + "observed CRT + branding in the running container") when reporting completion.

---

## Self-review notes (author)

- Spec coverage: CRT theme (Tasks 1-4, plus CSS Task 3), separate CRT section (Task 4-5), 4 phosphors + 4 effects (Tasks 1,3,4), per-device storage (Task 1), Customisation rename (Task 5), branding server-side name/hide/icon (Tasks 6-9), 128 KB PNG/SVG/ICO/JPEG (Tasks 9,11), navbar rendering + shared storage (Tasks 13-14), i18n EN/NL/DE (inline in UI tasks + Task 15), tests (each task), docs (Task 16). No gaps found.
- Type consistency: `applyCrt`, `getCrtPhosphor`, `setCrtEffect`, `CRT_PHOSPHORS`, `CRT_EFFECTS` used consistently; `brand_name`/`brand_hidden`/`brand_icon` identical across migration, model, repo, router, types, component, navbar; prop names `appSettings`/`onSaveAppSettings` (SettingsLocalSection) and `brandName`/`brandHidden`/`brandIcon` (StatusBar) consistent across definer and caller.
- Cross-file coupling (verified): `SettingsModal.tsx` already receives `appSettings` and `onSaveAppSettings` and passes them to sibling sections, so Task 12 Step 7 is a two-prop addition at SettingsModal.tsx:254 with no App.tsx threading required.
