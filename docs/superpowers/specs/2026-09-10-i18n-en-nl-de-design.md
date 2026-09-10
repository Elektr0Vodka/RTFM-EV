# RTFM-EV i18n (EN / NL / DE) — Design Spec

Date: 2026-09-10
Status: draft for review
Sub-project: N2 in `docs/parity-audit.md`; tracked in the `rtfm-ev-fork-port-plan` memory.

## 1. Goal

Make the RTFM-EV frontend fully usable in English, Dutch, and German. English is
the source of truth and the default. Conventions follow the DutchMeshCore family
(specifically DutchMeshCore-Observers) so the projects stay consistent, while the
implementation is idiomatic for RTFM-EV's React 18 + TypeScript + Vite stack.
Marcel Verdult's `kiekr-i18n` (CC-BY 4.0) is credited and its NL/DE strings are
reused opportunistically where UI text matches.

## 2. Locked decisions (from brainstorming)

- **Runtime:** custom-light, DMC-consistent. No new i18n runtime dependency.
- **Default language:** English, always, until the user changes it. **No**
  `navigator.language` auto-detection.
- **Migration scope:** framework **and** full migration of all user-facing
  strings across the app, delivered as batched domain-by-domain commits behind
  the framework (see §8) to survive concurrent PRs.
- **Placeholders:** `{name}` single-brace (DMC-Observers convention).
- **Plurals:** `Intl.PluralRules`-selected `{one, other, …}` objects.
- **Persistence:** `localStorage` key `'locale'`.
- **Fallback chain:** active locale → English → raw key.

## 3. Reference basis and consistency

Established by source inspection (2026-09-10):

- **DutchMeshCore-Observers** (`G:\Github\repositories\Dutch-MeshCore\DutchMeshCore-Observers`,
  Go + vanilla JS): flat snake_case prefixed keys (`nav_`, `map_`, …), `{name}`
  interpolation, `localStorage['locale']`, fallback `locale → en → key`, key-parity
  test, languages nl/en/de. It has **no** plural mechanism and **no** kiekr linkage.
  We copy its *conventions*, not its code (it is frameworkless JS).
- **kiekr-i18n** (Marcel Verdult, CC-BY 4.0): flat JSON, `%1$s` positional
  placeholders, ICU plural objects, `_meta`/`_ai`/`_human` bookkeeping, English
  fallback. We adopt the JSON-as-data idea and a minimal `_meta` block, but use
  `{name}` (not `%1$s`) to match DMC-Observers, and reuse NL/DE strings with credit.

Where the two references disagree, DMC-Observers wins on runtime conventions
(placeholders, default/fallback, persistence) because that is the DMC family's
actual practice; kiekr wins on file-as-JSON-data and translation-string reuse.

## 4. Architecture

New module `frontend/src/i18n/`:

```
frontend/src/i18n/
  locales/
    en.json        # source of truth
    nl.json        # seeded from kiekr where matching, else translated
    de.json        # seeded from kiekr where matching, else translated
  i18n.ts          # pure core: types, resolveLocale, interpolate, translate, formatCount
  I18nProvider.tsx # React Context provider, useT(), useLocale()
  index.ts         # re-exports
  i18n.test.ts     # unit tests (interpolation, plural, fallback)
  parity.test.ts   # every locale has exactly en's key set
```

### 4.1 Core types and functions (`i18n.ts`)

```ts
export type Locale = 'en' | 'nl' | 'de';
export const LOCALES: Locale[] = ['en', 'nl', 'de'];
export const DEFAULT_LOCALE: Locale = 'en';
export const STORAGE_KEY = 'locale';

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>; // { one, other, ... }
type Entry = string | PluralForms;
export type Catalog = Record<string, Entry>;   // '_'-prefixed keys are metadata, ignored by lookup/parity
type Params = Record<string, string | number>;

export function resolveLocale(saved: string | null): Locale;      // valid saved value, else DEFAULT_LOCALE
export function interpolate(tpl: string, params?: Params): string; // replaces {name} via /\{(\w+)\}/g
export function translate(
  catalogs: Record<Locale, Catalog>,
  locale: Locale,
  key: string,
  params?: Params,
): string; // plural selection when Entry is object + params.count present; fallback locale -> en -> key
```

- `resolveLocale`: pure; returns `saved` if it is one of `LOCALES`, else `'en'`.
  No `navigator.language` read (per decision).
- Plural selection: when the resolved `Entry` is an object and `params.count` is a
  number, pick the form via `new Intl.PluralRules(locale).select(params.count)`,
  falling back to `other`, then English, then the key. `{count}` is interpolated
  into the chosen form.
- All lookups skip keys beginning with `_` (metadata).

### 4.2 Provider and hooks (`I18nProvider.tsx`)

```ts
type TFn = (key: string, params?: Params) => string;
const I18nContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void; t: TFn }>(…);

export function I18nProvider({ children }): JSX.Element;  // holds locale in state, seeded from resolveLocale(localStorage)
export function useT(): TFn;                              // bound t for current locale
export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void };
```

- On mount: `locale = resolveLocale(localStorage.getItem(STORAGE_KEY))`, and set
  `document.documentElement.lang = locale`.
- `setLocale(l)`: update state, `localStorage.setItem(STORAGE_KEY, l)`, set
  `<html lang>`. Context change re-renders consumers (replaces the DMC-Observers
  `CustomEvent('i18n:changed')` mechanism, which exists only because that app has
  no framework).
- All `localStorage` access wrapped in try/catch (private-mode safety), mirroring
  existing preference helpers in `frontend/src/utils/`.
- `I18nProvider` mounts high in the tree (in `main.tsx` around `<App/>`, or at the
  top of `App.tsx`), consistent with the existing context providers in
  `frontend/src/contexts/`.

### 4.3 Number/date formatting

Existing `toLocaleString([...])` / `Intl.*` calls use the empty default locale
(browser locale). Replace the locale argument with the active app locale (via
`useLocale()` or a small `formatNumber/formatDate(locale, …)` helper in
`frontend/src/utils/`) so formatting follows the chosen language. Scope: numeric
and date/time display strings already using `toLocale*`. Not a new formatting
system — just threading the locale through.

## 5. Locale file schema and key conventions

```json
{
  "_meta": { "locale": "nl", "name": "Nederlands", "derived_from": "kiekr-i18n (CC-BY 4.0)" },
  "common_save": "Opslaan",
  "chat_undecrypted_try": {
    "one": "Probeer {count} opgeslagen pakket te ontsleutelen",
    "other": "Probeer {count} opgeslagen pakketten te ontsleutelen"
  }
}
```

- **Flat** keys, **snake_case**, **domain prefix** as pseudo-namespace. Initial
  prefix set (extend as needed): `common_`, `nav_`, `chat_`, `contact_`,
  `channel_`, `repeater_`, `packet_`, `map_`, `settings_`, `toast_`, `visualizer_`,
  `command_` (command palette), `a11y_` (aria-labels), `error_`.
- `en.json` defines the canonical key set. `nl.json`/`de.json` MUST have the same
  keys (parity test). Untranslated NL/DE values are allowed to be filled from
  English during development but the shipping target is full NL/DE coverage; the
  fallback chain guarantees no raw keys appear even if a value is temporarily
  missing.
- Counted strings use plural-form objects; callers pass `{ count }`.
- Naming guide lives in `frontend/AGENTS.md` (added) so future strings stay
  consistent.

## 6. Language selector

- New `LanguageSelector.tsx` under `frontend/src/components/settings/`, rendered in
  the Settings UI next to `ThemeSelector.tsx`.
- Three options (EN / NL / DE) with flag emoji + endonym (English / Nederlands /
  Deutsch). Calls `setLocale`. Reflects current selection.
- No page reload; the context change re-renders the tree.

## 7. Crediting Marcel Verdult (license compliance)

`kiekr-i18n` is CC-BY 4.0 → attribution required when its strings or approach are
reused. Deliverables:

- A credit block in `frontend/README.md` (or root `README`/`CONTEXT.md` as the
  repo prefers):
  > Internationalization approach and portions of the Dutch/German translation
  > strings are adapted from kiekr-i18n by Marcel Verdult (@marcelverdult),
  > https://github.com/marcelverdult/kiekr-i18n, licensed under CC-BY 4.0.
- `_meta.derived_from` in `nl.json`/`de.json` where kiekr strings are reused.
- Reuse is **manual and opportunistic** (kiekr keys map to the KiekR app UI, not
  RTFM-EV's components). No submodule, npm dep, or automated sync.

## 8. Migration approach (full, batched)

End state: no user-facing hardcoded literal remains; all route through `t()`.
Because this touches most of ~111 `.tsx` files while other sessions land PRs,
execute as **framework-first, then domain batches**, each a self-contained commit:

1. **Batch 0 — framework:** `i18n/` module, provider wired into the tree,
   `LanguageSelector`, `en.json` bootstrap, tests, ESLint guard (warn), AGENTS.md
   naming guide. No behavior change yet (English strings identical).
2. **Batches 1..N — by domain**, each: extract that domain's strings into `en.json`
   keys, replace literals/aria-label/placeholder/title/toast with `t()`, add NL/DE
   values. Suggested order by user-visibility: nav/app-shell → chat (header,
   message list, new-message) → contacts/channels → settings → repeater console →
   packet feed/visualizer → command palette → remaining dialogs/toasts.
3. **Finalization:** flip the ESLint no-literal rule from warn to error; NL/DE
   coverage pass; parity + render tests green.

Rationale for batching under "full scope": one 111-file PR would conflict badly
with the in-flight PRs (#4–#7) in this repo. Batches keep each change reviewable
and landable, while the spec's Definition of Done still requires the whole app
migrated.

### String extraction rules
- Translate: visible text, `aria-label`, `placeholder`, `title`, `alt`, and Sonner
  `toast.*` messages.
- Do **not** translate: brand/protocol tokens (MeshCore, RTFM, channel key text,
  hex pubkeys), log lines, developer-only console output, test fixtures.
- Replace hand-rolled English pluralization (e.g. `count !== 1 ? 's' : ''`) with
  plural-form keys.

## 9. Testing and guardrails

- `parity.test.ts`: `nl`/`de` key sets (excluding `_`-prefixed) equal `en`'s.
- `i18n.test.ts`: `{name}` interpolation; plural selection for en/nl/de via
  `Intl.PluralRules`; fallback `locale → en → key`; `resolveLocale` validity.
- A render/integration test: switching locale updates visible text and persists to
  `localStorage`.
- ESLint rule to flag new hardcoded JSX string literals (custom rule or
  `eslint-plugin-i18next`/`formatjs` no-literal-string), warn during migration →
  error at finalization. Adding an ESLint plugin devDependency is acceptable; a
  runtime i18n dependency is not.
- `tsc` typecheck and `vite build` pass; existing Vitest suite stays green.

## 10. Risks and mitigations

- **Large surface / merge conflicts** (highest): batched domain commits (§8);
  land promptly; coordinate with concurrent sessions; keep Batch 0 minimal.
- **NL/DE translation correctness:** English fallback prevents broken UI;
  `_meta.derived_from` and a review pass; native-speaker review recommended before
  finalization. Track review state per key only if desired (optional, kiekr-style
  `_human` flag) — out of scope for first pass.
- **Plural correctness (NL/DE):** covered by `Intl.PluralRules`; unit-tested.
- **Missed strings:** ESLint no-literal guard catches new/most existing ones.
- **Formatting locale drift:** number/date threading (§4.3) is explicit scope.

## 11. Out of scope

- Backend / server-side language, email and push-notification localization.
- RTL layout (not needed for en/nl/de).
- Automated kiekr-i18n sync or shared key schema with KiekR.
- Additional languages beyond en/nl/de (the framework supports adding them later
  by dropping in a locale file + `LOCALES` entry).

## 12. Definition of done

- All in-scope user-facing strings across the frontend route through `t()`; ESLint
  no-literal rule passes at error level.
- `en.json`, `nl.json`, `de.json` exist with identical key sets; parity test green.
- Language selector in Settings switches all visible text live and persists across
  reloads; `<html lang>` updates.
- Number/date display follows the selected locale.
- Fallback verified: a deliberately missing NL/DE key renders English, never a raw
  key.
- Marcel Verdult / kiekr-i18n CC-BY 4.0 credit present in README and locale `_meta`.
- `tsc`, `vite build`, and the full Vitest suite pass.
