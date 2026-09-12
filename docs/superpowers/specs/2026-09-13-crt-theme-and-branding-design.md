# CRT theme + Branding customisation — design

Status: design phase (awaiting spec review). Date: 2026-09-13.

## Goal

Two related additions to the RTFM-EV frontend Customisation surface:

1. A **CRT theme** inspired by retro systems (MSX, C64, amber terminals): a dark
   monochrome-phosphor look with the classic CRT artefacts (scanlines, phosphor
   glow, screen curvature/vignette, flicker). The default phosphor is **green**.
   Multiple phosphor colours are offered **without adding entries to the theme
   swatch grid** — they live in a dedicated CRT section instead.
2. **Branding customisation**: let the operator rename the navbar `RemoteTerm`
   wordmark, hide/show it, and upload a custom icon. Branding is **server-side**
   (shared across every device that connects to this instance).

## Non-goals

- No changes to the existing themes. Every CRT rule is gated on
  `[data-theme='crt']`; shared-DOM additions are inert under all other themes.
- CRT phosphor colour and effect toggles are **not** server-side; they are
  per-device `localStorage` preferences, matching the existing theme selection.
- No new messaging, map, or radio features.
- No authentication / per-user branding. Branding is instance-wide (single-row
  `app_settings`), consistent with the rest of that table.

## Decisions (locked with the user)

| Decision | Choice |
| --- | --- |
| CRT colour selector placement | **Separate CRT section** in the Customisation panel, not in the swatch grid |
| Phosphor colours shipped | **Green (default), Amber, White/grey, Blue (C64)** |
| CRT effects | **Scanlines, phosphor glow, curvature/vignette, flicker** — each individually toggleable |
| CRT storage | **Per-device (`localStorage`)**, like the existing theme |
| Branding scope | **Name + hide toggle + custom icon upload** |
| Branding storage | **Server-side** (`app_settings`, shared across devices) |
| Icon cap / formats | **≤128KB encoded, PNG / SVG / ICO / JPEG**, stored as a data URL |
| Section rename | "Color scheme" heading becomes **"Customisation"** |

## CRT integration approach (chosen: Approach 1)

CRT is a dedicated theme id (`crt`) in the existing `applyTheme` / `data-theme`
system, but it is **not** listed in the swatch grid. A dedicated **CRT section**
in the Customisation panel owns: enable toggle, phosphor colour picker, and the
four effect toggles. Phosphor colour and effect toggles are stamped as data
attributes on `<html>` and layered in `themes.css`.

Mutual exclusion with grid themes is automatic: both write the single
`data-theme`. `getSavedTheme()` remains the one source of truth, so selecting a
grid theme deactivates CRT and vice-versa.

Rejected alternatives:
- Four CRT entries in the grid — clutters the grid (user constraint).
- CRT as a layer independent of `data-theme`, stackable on any theme — a
  monochrome phosphor over an arbitrary palette is incoherent and doubles state.

## Existing architecture (verified)

- `frontend/src/utils/theme.ts` — `THEMES[]` registry; `applyTheme()` writes
  `document.documentElement.dataset.theme` and persists to
  `localStorage['remoteterm-theme']`. `'original'` = no attribute. Dispatches
  `THEME_CHANGE_EVENT`.
- `frontend/src/themes.css` — one `:root[data-theme='<id>']` block per theme
  overriding CSS-variable tokens (HSL triplets), plus optional scoped structural
  rules. Windows 95 is the precedent for heavy structural theming
  (chunky borders, custom scrollbars, disabled animations).
- `frontend/src/components/settings/ThemeSelector.tsx` — swatch grid of radios.
- `frontend/src/components/settings/SettingsLocalSection.tsx:301-305` — the
  `settings_color_scheme` block wrapping `ThemeSelector` + `ThemePreview`.
- `frontend/src/components/StatusBar.tsx:202-214` — the navbar `<h1>` with a
  hardcoded inline SVG logo and the literal string `RemoteTerm`.
- Server settings: single-row `app_settings` table. `AppSettings` pydantic model
  (`app/models.py`), `AppSettingsRepository` get/`_apply_updates`/`update`
  (`app/repository/settings.py`), `AppSettingsUpdate` + `PATCH /settings`
  (`app/routers/settings.py`). Fetched once on load via `useAppSettings`
  (`frontend/src/hooks/useAppSettings.ts`) + prefetch; mutated via
  `api.updateSettings` (`frontend/src/api.ts:446-451`). Latest migration is
  `_081_create_wordlists.py`; next free number is **_082**.

## Design

### 1. CRT theme (frontend only)

**New `frontend/src/utils/crt.ts`**
- Constants: phosphor ids `['green','amber','white','blue']` (green = default);
  effect ids `['scanlines','glow','curvature','flicker']` (all default on).
- `localStorage` keys: `remoteterm-crt-phosphor`, and one per effect
  (e.g. `remoteterm-crt-scanlines`).
- `getCrtPhosphor()` / `setCrtPhosphor()`, `getCrtEffect()` / `setCrtEffect()`.
- `applyCrt()`: stamps `data-crt-phosphor` and `data-crt-<effect>="0|1"` on
  `<html>`. A no-op visually unless `data-theme='crt'` (CSS gates on both).

**Wiring**
- `applyTheme()` calls `applyCrt()` after setting `data-theme` so attributes are
  present whenever CRT becomes active.
- `main.tsx` bootstrap calls `applyCrt()` alongside the existing theme init.

**`themes.css` additions (all gated on `[data-theme='crt']`)**
- Base `:root[data-theme='crt']` block: dark near-black background, green
  phosphor foreground/accent tokens, mono font stack, tightened radii.
- Phosphor variants: `:root[data-theme='crt'][data-crt-phosphor='amber']` (etc.)
  override the foreground/primary/accent tokens. `green` needs no override.
- Effect overlays, each gated on its toggle attribute defaulting on
  (`:root[data-theme='crt']:not([data-crt-scanlines='0'])` …):
  - **Scanlines**: a fixed full-viewport overlay (`repeating-linear-gradient`),
    `pointer-events:none`, low opacity.
  - **Glow**: phosphor-coloured `text-shadow` on body text / brand.
  - **Curvature/vignette**: inset radial shadow on the app frame.
  - **Flicker**: subtle opacity keyframes on the scanline overlay, **disabled
    under `@media (prefers-reduced-motion: reduce)`**.
- Add `crt` to the swatch grid? **No.** It is intentionally excluded to keep the
  grid uncluttered; the CRT section is its entry point.

### 2. Customisation panel restructure

`SettingsLocalSection.tsx`:
- Rename the `settings_color_scheme` heading to a new `settings_customisation`
  key ("Customisation").
- Keep `ThemeSelector` + `ThemePreview`.
- Add **`CrtSettings.tsx`** (new): an "Enable CRT" control (activates the `crt`
  theme via `applyTheme('crt')`, reflects `getSavedTheme() === 'crt'`), a
  phosphor colour picker (4 swatches), and 4 effect toggles. Controls other than
  the enable toggle are shown/enabled only while CRT is active.
- Add **`BrandingSettings.tsx`** (new): see §4.

### 3. Branding backend (server-side)

**Migration `_082_add_branding.py`** adds to `app_settings`:
- `brand_name TEXT NOT NULL DEFAULT ''`
- `brand_hidden INTEGER NOT NULL DEFAULT 0`
- `brand_icon TEXT NOT NULL DEFAULT ''` (data URL, or empty)

**Model / repository / router** (mirror the existing per-field pattern):
- `AppSettings`: add `brand_name: str = ''`, `brand_hidden: bool = False`,
  `brand_icon: str = ''`.
- `AppSettingsRepository._get_in_conn`: select + parse the three columns
  (guarded with `try/except KeyError` like siblings).
- `AppSettingsRepository._apply_updates` and `.update`: add the three params.
- `AppSettingsUpdate`: `brand_name: str | None`, `brand_hidden: bool | None`,
  `brand_icon: str | None`.
- `update_settings` handler: persist when provided. Validate `brand_icon`:
  - Empty string clears it.
  - Otherwise must be a `data:` URL of an allowed type
    (`image/png`, `image/svg+xml`, `image/x-icon` / `image/vnd.microsoft.icon`,
    `image/jpeg`).
  - Encoded length ≤ **131072** bytes (128KB); reject with HTTP 400 otherwise.
  - `brand_name` trimmed; length cap (e.g. 64 chars) to keep the navbar sane.

### 4. Branding frontend

**`BrandingSettings.tsx`** (inside Customisation):
- Text input bound to `brand_name` (placeholder shows the default `RemoteTerm`).
- Show/hide toggle bound to `brand_hidden`.
- Icon upload: `<input type="file">` → `FileReader.readAsDataURL`; client-side
  type + ≤128KB checks before saving (mirrors the server rule so users get an
  immediate error). Preview thumbnail; a "Remove icon" action clears it.
- Saves via `handleSaveAppSettings` (existing `useAppSettings` path).

**Navbar wiring** (`StatusBar.tsx`):
- Receive the brand fields (via the `appSettings` already threaded through the
  app shell; add props if not already present).
- Render: custom icon (if set) else the built-in SVG; custom name (if set) else
  `RemoteTerm`. When `brand_hidden`, hide the **text label** but keep the icon.
- The literal `RemoteTerm` becomes the fallback default (still not i18n copy — it
  is a product name).

**`api.ts` / `types`**: extend `AppSettings` and `AppSettingsUpdate` with the
three brand fields.

### 5. Cross-cutting

- **i18n**: every new user-facing string gets a `t()` key in EN/NL/DE
  (eslint + parity test enforce this). New keys include the section title,
  CRT labels (enable, phosphor names, effect names), and branding labels
  (name, hide, upload, remove, size/type error messages).
- **Tests**:
  - `crt` unit test: `applyCrt()` stamps the right attributes; reduced-motion
    path documented.
  - Settings round-trip test: branding fields persist and reject an oversized /
    wrong-type icon (backend), and the `BrandingSettings` form saves (frontend).
  - `StatusBar` render test: default vs custom name, hidden label, custom icon.
- **Docs**:
  - `CHANGELOG-DMC-EV.md`: entry under the appropriate area.
  - `README.md` / `README_ADVANCED.md`: add CRT theme + branding to the feature
    list where themes/customisation are described.
  - `AGENTS.md` / `docs/` only if the settings surface is documented there.

## Risk / limitations

- The icon data URL rides on every `GET /settings` (prefetched on load). At the
  128KB cap this adds up to ~128KB to that one payload; acceptable for a
  single-instance operator tool, but noted. A future move to a dedicated icon
  endpoint is possible without changing the UI contract.
- CRT flicker can distract or trigger discomfort; it is individually toggleable
  and force-disabled under `prefers-reduced-motion`.
- Curvature/vignette can dim screen edges; toggleable and default-on but
  reversible per device.
- CRT and grid themes share `data-theme`, so they are mutually exclusive by
  construction — switching one deactivates the other (intended).

## Out of scope / future

- Server-side CRT (shared phosphor/effects) — explicitly deferred; per-device now.
- Per-user branding / multi-tenant identity.
- Additional phosphor palettes beyond the four shipped.
