# Settings "Handy Info" Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "Handy Info" settings section (above About) that lists useful external MeshCore endpoints with Open / Copy / Apply actions wired into the existing sync settings.

**Architecture:** One new presentational React component plus small edits to the shared settings section registry and the modal. Static endpoint data lives as consts in the component. Apply actions reuse the already-threaded `onSaveAppSettings`. No backend, migration, or API changes.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, flat-JSON i18n (en/nl/de), lucide-react icons, sonner toasts.

**Spec:** `docs/superpowers/specs/2026-09-11-settings-handy-info-section-design.md`

**Repo git rule (overrides the skill's commit steps):** Do NOT create git commits. This repo's CLAUDE.md forbids committing unless the user explicitly instructs it. Each task ends with a verification checkpoint instead of a commit. Stage nothing unless asked.

**All commands run from** `frontend/` (the worktree's frontend directory) unless stated otherwise.

---

## File Structure

- Create: `frontend/src/components/settings/SettingsHandyInfoSection.tsx` — the section component: static endpoint data + Open/Copy/Apply handlers.
- Create: `frontend/src/test/settingsHandyInfoSection.test.tsx` — component behavior tests.
- Modify: `frontend/src/components/settings/settingsConstants.ts` — register the `handy-info` section (union, order, label key, icon).
- Modify: `frontend/src/components/SettingsModal.tsx` — add to `expandedSections` state and render the section directly above About.
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json` — new `t()` keys (parity-enforced across all three).
- Modify: `frontend/src/test/settingsModal.test.tsx` — assert the section renders above About.

No exhaustive `switch` over `SettingsSection` exists, so adding a union member is safe. `SETTINGS_SECTION_ORDER` feeds the desktop sidebar (`AppShell.tsx:202`) and the command palette (`CommandPalette.tsx:98`); the new section therefore appears in both automatically with no extra edits.

---

## Task 1: Add i18n keys to all three locales

**Files:**
- Modify: `frontend/src/i18n/locales/en.json` (after `"settings_section_about"`, line ~1648)
- Modify: `frontend/src/i18n/locales/nl.json` (after `"settings_section_about"`, line ~1649)
- Modify: `frontend/src/i18n/locales/de.json` (after `"settings_section_about"`, line ~1649)
- Test: `frontend/src/test/i18nParity.test.ts` (existing; must stay green)

- [ ] **Step 1: Add the English keys**

In `en.json`, immediately after the `"settings_section_about": "About",` line, insert:

```json
  "settings_section_handy_info": "Handy Info",
  "settings_handy_intro": "Useful external MeshCore endpoints. Copy a URL, or Apply it straight into your sync settings.",
  "settings_handy_analyzers_heading": "External Node Analyzers",
  "settings_handy_analyzers_desc": "Apply adds the analyzer so node lookups open from contacts and packets.",
  "settings_handy_sync_heading": "Sync Sources",
  "settings_handy_sync_desc": "Apply sets the matching sync URL used by the Database section.",
  "settings_handy_links_heading": "Reference Links",
  "settings_handy_sync_region_label": "Region scopes",
  "settings_handy_sync_registry_label": "Channel registry",
  "settings_handy_link_dutch_settings_label": "Dutch mesh settings",
  "settings_handy_link_channel_browser_label": "DMC channel browser",
  "settings_handy_link_meshwiki_label": "Region list (meshwiki)",
  "settings_handy_open": "Open",
  "settings_handy_copy": "Copy",
  "settings_handy_apply": "Apply",
  "settings_handy_added": "Added",
  "settings_handy_open_aria": "Open {name}",
  "settings_handy_copy_aria": "Copy {name} URL",
  "settings_handy_apply_aria": "Apply {name}",
  "settings_handy_toast_copied": "Copied to clipboard",
  "settings_handy_toast_analyzer_added": "Added {name} to analyzers",
  "settings_handy_toast_analyzer_exists": "{name} is already in your analyzers",
  "settings_handy_toast_sync_applied": "Applied {name}",
  "settings_handy_toast_apply_failed": "Could not save the setting",
  "settings_handy_confirm_overwrite": "A different URL is already set. Replace it with {name}?",
```

- [ ] **Step 2: Add the Dutch keys**

In `nl.json`, immediately after the `"settings_section_about": "Over",` line, insert:

```json
  "settings_section_handy_info": "Handige Info",
  "settings_handy_intro": "Handige externe MeshCore-endpoints. Kopieer een URL of pas hem direct toe in je synchronisatie-instellingen.",
  "settings_handy_analyzers_heading": "Externe Node-Analyzers",
  "settings_handy_analyzers_desc": "Toepassen voegt de analyzer toe zodat node-opzoekingen openen vanuit contacten en pakketten.",
  "settings_handy_sync_heading": "Synchronisatiebronnen",
  "settings_handy_sync_desc": "Toepassen stelt de bijbehorende synchronisatie-URL in die de Database-sectie gebruikt.",
  "settings_handy_links_heading": "Referentielinks",
  "settings_handy_sync_region_label": "Regio-scopes",
  "settings_handy_sync_registry_label": "Kanaalregister",
  "settings_handy_link_dutch_settings_label": "Nederlandse mesh-instellingen",
  "settings_handy_link_channel_browser_label": "DMC-kanaalbrowser",
  "settings_handy_link_meshwiki_label": "Regiolijst (meshwiki)",
  "settings_handy_open": "Openen",
  "settings_handy_copy": "Kopiëren",
  "settings_handy_apply": "Toepassen",
  "settings_handy_added": "Toegevoegd",
  "settings_handy_open_aria": "{name} openen",
  "settings_handy_copy_aria": "URL van {name} kopiëren",
  "settings_handy_apply_aria": "{name} toepassen",
  "settings_handy_toast_copied": "Gekopieerd naar klembord",
  "settings_handy_toast_analyzer_added": "{name} toegevoegd aan analyzers",
  "settings_handy_toast_analyzer_exists": "{name} staat al in je analyzers",
  "settings_handy_toast_sync_applied": "{name} toegepast",
  "settings_handy_toast_apply_failed": "Kon de instelling niet opslaan",
  "settings_handy_confirm_overwrite": "Er is al een andere URL ingesteld. Vervangen door {name}?",
```

- [ ] **Step 3: Add the German keys**

In `de.json`, immediately after the `"settings_section_about": "Über",` line, insert:

```json
  "settings_section_handy_info": "Praktische Infos",
  "settings_handy_intro": "Nützliche externe MeshCore-Endpunkte. Kopiere eine URL oder übernimm sie direkt in deine Synchronisationseinstellungen.",
  "settings_handy_analyzers_heading": "Externe Node-Analyzer",
  "settings_handy_analyzers_desc": "Übernehmen fügt den Analyzer hinzu, sodass Node-Abfragen aus Kontakten und Paketen geöffnet werden.",
  "settings_handy_sync_heading": "Synchronisationsquellen",
  "settings_handy_sync_desc": "Übernehmen setzt die zugehörige Synchronisations-URL, die der Datenbankbereich verwendet.",
  "settings_handy_links_heading": "Referenzlinks",
  "settings_handy_sync_region_label": "Regionen-Scopes",
  "settings_handy_sync_registry_label": "Kanalregister",
  "settings_handy_link_dutch_settings_label": "Niederländische Mesh-Einstellungen",
  "settings_handy_link_channel_browser_label": "DMC-Kanalbrowser",
  "settings_handy_link_meshwiki_label": "Regionsliste (meshwiki)",
  "settings_handy_open": "Öffnen",
  "settings_handy_copy": "Kopieren",
  "settings_handy_apply": "Übernehmen",
  "settings_handy_added": "Hinzugefügt",
  "settings_handy_open_aria": "{name} öffnen",
  "settings_handy_copy_aria": "URL von {name} kopieren",
  "settings_handy_apply_aria": "{name} übernehmen",
  "settings_handy_toast_copied": "In die Zwischenablage kopiert",
  "settings_handy_toast_analyzer_added": "{name} zu Analyzern hinzugefügt",
  "settings_handy_toast_analyzer_exists": "{name} ist bereits in deinen Analyzern",
  "settings_handy_toast_sync_applied": "{name} übernommen",
  "settings_handy_toast_apply_failed": "Einstellung konnte nicht gespeichert werden",
  "settings_handy_confirm_overwrite": "Es ist bereits eine andere URL gesetzt. Durch {name} ersetzen?",
```

- [ ] **Step 4: Verify locale JSON is valid and keys are at parity**

Run: `npm run test:run -- src/test/i18nParity.test.ts`
Expected: PASS (both "nl has exactly the same keys as en" and "de has exactly the same keys as en"). A failure here means a key was mistyped or missed in one locale — fix before moving on.

---

## Task 2: Register the `handy-info` section in the shared registry

**Files:**
- Modify: `frontend/src/components/settings/settingsConstants.ts`

- [ ] **Step 1: Add the icon import and the union member**

In `settingsConstants.ts`, add `Lightbulb` to the lucide-react import (keep the list alphabetical-ish, matching the existing style):

```ts
import {
  BarChart3,
  Database,
  Info,
  Lightbulb,
  MonitorCog,
  RadioTower,
  Share2,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
```

Add `'handy-info'` to the `SettingsSection` union:

```ts
export type SettingsSection =
  | 'radio'
  | 'local'
  | 'radio-app'
  | 'database'
  | 'fanout'
  | 'statistics'
  | 'handy-info'
  | 'about';
```

- [ ] **Step 2: Insert into order, labels, and icons**

Update `SETTINGS_SECTION_ORDER` to place `'handy-info'` immediately before `'about'`:

```ts
export const SETTINGS_SECTION_ORDER: SettingsSection[] = [
  'radio',
  'local',
  'fanout',
  'radio-app',
  'database',
  'statistics',
  'handy-info',
  'about',
];
```

Add the label key to `SETTINGS_SECTION_LABEL_KEYS`:

```ts
const SETTINGS_SECTION_LABEL_KEYS: Record<SettingsSection, string> = {
  radio: 'settings_section_radio',
  local: 'settings_section_local',
  'radio-app': 'settings_section_radio_app',
  database: 'settings_section_database',
  fanout: 'settings_section_fanout',
  statistics: 'settings_section_statistics',
  'handy-info': 'settings_section_handy_info',
  about: 'settings_section_about',
};
```

Add the icon to `SETTINGS_SECTION_ICONS`:

```ts
export const SETTINGS_SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  radio: RadioTower,
  local: MonitorCog,
  'radio-app': SlidersHorizontal,
  database: Database,
  fanout: Share2,
  statistics: BarChart3,
  'handy-info': Lightbulb,
  about: Info,
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. Because `SettingsSection` is used as a `Record` key in several files, this fails loudly if any consumer's map is now missing the `handy-info` entry. The known consumer needing an added key is the modal's `expandedSections` (fixed in Task 4). If tsc reports `expandedSections` missing `handy-info`, that is expected here and resolved in Task 4 — you may proceed once the only remaining error is that one, or do Task 4 next and re-run.

---

## Task 3: Build the SettingsHandyInfoSection component (TDD)

**Files:**
- Test: `frontend/src/test/settingsHandyInfoSection.test.tsx` (create)
- Create: `frontend/src/components/settings/SettingsHandyInfoSection.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/settingsHandyInfoSection.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsHandyInfoSection } from '../components/settings/SettingsHandyInfoSection';
import type { AppSettings } from '../types';

const { toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
}));

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    max_radio_contacts: 200,
    auto_decrypt_dm_on_advert: false,
    last_message_times: {},
    advert_interval: 0,
    last_advert_time: 0,
    flood_scope: '',
    known_regions: [],
    blocked_keys: [],
    blocked_names: [],
    discovery_blocked_types: [],
    tracked_telemetry_repeaters: [],
    tracked_telemetry_contacts: [],
    auto_resend_channel: false,
    telemetry_interval_hours: 8,
    telemetry_routed_hourly: false,
    show_mention_ticker: true,
    registry_sync_url: '',
    region_sync_url: '',
    wordlist_sync_url: '',
    analyzer_sites: [],
    ...overrides,
  };
}

const writeText = vi.fn();

function renderSection(
  appSettings: AppSettings | null,
  onSave = vi.fn().mockResolvedValue(undefined)
) {
  render(<SettingsHandyInfoSection appSettings={appSettings} onSaveAppSettings={onSave} />);
  return { onSave };
}

describe('SettingsHandyInfoSection', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    writeText.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders analyzer, sync, and reference entries', () => {
    renderSection(makeSettings());
    expect(screen.getByText('Cornmeister')).toBeInTheDocument();
    expect(screen.getByText('MC-Radar')).toBeInTheDocument();
    expect(screen.getByText('Region scopes')).toBeInTheDocument();
    expect(screen.getByText('Channel registry')).toBeInTheDocument();
    expect(screen.getByText('Dutch mesh settings')).toBeInTheDocument();
    expect(screen.getByText('DMC channel browser')).toBeInTheDocument();
    expect(screen.getByText('Region list (meshwiki)')).toBeInTheDocument();
  });

  it('copies an analyzer node template to the clipboard', () => {
    renderSection(makeSettings());
    fireEvent.click(screen.getByRole('button', { name: 'Copy Cornmeister URL' }));
    expect(writeText).toHaveBeenCalledWith('https://cornmeister.nl/#node?id={pubkey}');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('applies an analyzer preset by appending to analyzer_sites', async () => {
    const { onSave } = renderSection(makeSettings());
    fireEvent.click(screen.getByRole('button', { name: 'Apply MC-Radar' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        analyzer_sites: [
          {
            name: 'MC-Radar',
            node_url_template: 'https://mc-radar.woodwar.com/node/{pubkey}',
            packet_url_template: null,
          },
        ],
      })
    );
  });

  it('does not duplicate an analyzer that is already configured', () => {
    const { onSave } = renderSection(
      makeSettings({
        analyzer_sites: [
          {
            name: 'Cornmeister',
            node_url_template: 'https://cornmeister.nl/#node?id={pubkey}',
            packet_url_template: null,
          },
        ],
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply Cornmeister' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalled();
  });

  it('applies a sync URL into an empty field', async () => {
    const { onSave } = renderSection(makeSettings({ region_sync_url: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Region scopes' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        region_sync_url: 'https://meshcore-analyzer.eu/api/regions/scopes',
      })
    );
  });

  it('confirms before overwriting a different existing sync URL', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onSave } = renderSection(
      makeSettings({ registry_sync_url: 'https://example.com/other.json' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply Channel registry' }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        registry_sync_url: 'https://meshcore-analyzer.eu/api/channels',
      })
    );
  });

  it('does not overwrite when the confirm is cancelled', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onSave } = renderSection(
      makeSettings({ registry_sync_url: 'https://example.com/other.json' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply Channel registry' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/test/settingsHandyInfoSection.test.tsx`
Expected: FAIL — cannot resolve `../components/settings/SettingsHandyInfoSection` (module does not exist yet).

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/settings/SettingsHandyInfoSection.tsx`:

```tsx
import type { AppSettings, AppSettingsUpdate } from '../../types';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import { useT } from '../../i18n';

interface AnalyzerPreset {
  name: string;
  site: string;
  template: string;
}

// Node URL schemes verified against docs/sources-of-truth.md and the
// EU-Meshcore-Analyzer source (web/index.html: per-node route #node?id=<pubkey>).
const ANALYZERS: AnalyzerPreset[] = [
  { name: 'Cornmeister', site: 'https://cornmeister.nl', template: 'https://cornmeister.nl/#node?id={pubkey}' },
  { name: 'MC-Radar', site: 'https://mc-radar.woodwar.com', template: 'https://mc-radar.woodwar.com/node/{pubkey}' },
  { name: 'meshcore-analyzer.eu', site: 'https://meshcore-analyzer.eu', template: 'https://meshcore-analyzer.eu/#node?id={pubkey}' },
  { name: 'MeshCoreNetz', site: 'https://analyzer.meshcorenetz.de', template: 'https://analyzer.meshcorenetz.de/#node?id={pubkey}' },
  { name: 'MeshDresden', site: 'https://analyzer.meshdresden.eu', template: 'https://analyzer.meshdresden.eu/#node?id={pubkey}' },
];

type SyncField = 'region_sync_url' | 'registry_sync_url';

interface SyncSource {
  labelKey: string;
  field: SyncField;
  url: string;
}

const SYNC_SOURCES: SyncSource[] = [
  { labelKey: 'settings_handy_sync_region_label', field: 'region_sync_url', url: 'https://meshcore-analyzer.eu/api/regions/scopes' },
  { labelKey: 'settings_handy_sync_registry_label', field: 'registry_sync_url', url: 'https://meshcore-analyzer.eu/api/channels' },
];

interface ReferenceLink {
  labelKey: string;
  url: string;
}

const REFERENCE_LINKS: ReferenceLink[] = [
  { labelKey: 'settings_handy_link_dutch_settings_label', url: 'https://settings.dutchmeshcore.nl' },
  { labelKey: 'settings_handy_link_channel_browser_label', url: 'https://toolbox.dutchmeshcore.nl/#/channel-browser' },
  { labelKey: 'settings_handy_link_meshwiki_label', url: 'https://meshwiki.nl/wiki/Lijst_van_regio%27s' },
];

export function SettingsHandyInfoSection({
  appSettings,
  onSaveAppSettings,
  className,
}: {
  appSettings: AppSettings | null;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  className?: string;
}) {
  const t = useT();

  const copy = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success(t('settings_handy_toast_copied'));
  };

  const isAnalyzerConfigured = (preset: AnalyzerPreset): boolean =>
    (appSettings?.analyzer_sites ?? []).some((s) => s.node_url_template === preset.template);

  const applyAnalyzer = (preset: AnalyzerPreset) => {
    if (isAnalyzerConfigured(preset)) {
      toast.info(t('settings_handy_toast_analyzer_exists', { name: preset.name }));
      return;
    }
    const next = [
      ...(appSettings?.analyzer_sites ?? []),
      { name: preset.name, node_url_template: preset.template, packet_url_template: null },
    ];
    void onSaveAppSettings({ analyzer_sites: next })
      .then(() => toast.success(t('settings_handy_toast_analyzer_added', { name: preset.name })))
      .catch(() => toast.error(t('settings_handy_toast_apply_failed')));
  };

  const applySync = (source: SyncSource) => {
    const name = t(source.labelKey);
    const current = (appSettings?.[source.field] ?? '').trim();
    if (current && current !== source.url) {
      if (!window.confirm(t('settings_handy_confirm_overwrite', { name }))) return;
    }
    const update: AppSettingsUpdate =
      source.field === 'region_sync_url'
        ? { region_sync_url: source.url }
        : { registry_sync_url: source.url };
    void onSaveAppSettings(update)
      .then(() => toast.success(t('settings_handy_toast_sync_applied', { name })))
      .catch(() => toast.error(t('settings_handy_toast_apply_failed')));
  };

  return (
    <div className={className}>
      <div className="space-y-4">
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_handy_intro')}</p>

        {/* External node analyzers */}
        <div className="space-y-3">
          <h3 className="text-base font-semibold tracking-tight">
            {t('settings_handy_analyzers_heading')}
          </h3>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_handy_analyzers_desc')}
          </p>
          <ul className="space-y-2">
            {ANALYZERS.map((a) => {
              const configured = isAnalyzerConfigured(a);
              return (
                <li
                  key={a.template}
                  className="rounded-md border border-border p-2.5 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <a
                      href={a.site}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary hover:underline"
                      aria-label={t('settings_handy_open_aria', { name: a.name })}
                    >
                      {a.name}
                    </a>
                    <div className="text-xs font-mono text-muted-foreground break-all">
                      {a.template}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copy(a.template)}
                      aria-label={t('settings_handy_copy_aria', { name: a.name })}
                    >
                      {t('settings_handy_copy')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={configured}
                      onClick={() => applyAnalyzer(a)}
                      aria-label={t('settings_handy_apply_aria', { name: a.name })}
                    >
                      {configured ? t('settings_handy_added') : t('settings_handy_apply')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <Separator />

        {/* Sync sources */}
        <div className="space-y-3">
          <h3 className="text-base font-semibold tracking-tight">
            {t('settings_handy_sync_heading')}
          </h3>
          <p className="text-[0.8125rem] text-muted-foreground">{t('settings_handy_sync_desc')}</p>
          <ul className="space-y-2">
            {SYNC_SOURCES.map((s) => {
              const name = t(s.labelKey);
              return (
                <li
                  key={s.field}
                  className="rounded-md border border-border p-2.5 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary hover:underline"
                      aria-label={t('settings_handy_open_aria', { name })}
                    >
                      {name}
                    </a>
                    <div className="text-xs font-mono text-muted-foreground break-all">{s.url}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copy(s.url)}
                      aria-label={t('settings_handy_copy_aria', { name })}
                    >
                      {t('settings_handy_copy')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => applySync(s)}
                      aria-label={t('settings_handy_apply_aria', { name })}
                    >
                      {t('settings_handy_apply')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <Separator />

        {/* Reference links */}
        <div className="space-y-3">
          <h3 className="text-base font-semibold tracking-tight">
            {t('settings_handy_links_heading')}
          </h3>
          <ul className="space-y-2">
            {REFERENCE_LINKS.map((l) => {
              const name = t(l.labelKey);
              return (
                <li
                  key={l.url}
                  className="rounded-md border border-border p-2.5 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-xs font-mono text-muted-foreground break-all">{l.url}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('settings_handy_open_aria', { name })}
                    >
                      <Button variant="outline" size="sm" asChild={false}>
                        {t('settings_handy_open')}
                      </Button>
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
```

Note on the reference-link "Open" button: it is a real `<a>` wrapping a `Button` for styling. If the `Button` component forwards an `asChild` prop you prefer to use instead, keep the accessible name as the link's `aria-label` so the test query `getByRole('button', { name: 'Apply ...' })` and link queries stay stable. The plan's tests only assert on Copy/Apply buttons and entry text, not the Open control, so either rendering works.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/test/settingsHandyInfoSection.test.tsx`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Lint the new component**

Run: `npm run lint`
Expected: no errors. If `i18next/no-literal-string` flags the JSX `Open`/`Copy`/`Apply` (it should not — they are `t()` calls) or the const string arrays (const declarations are not JSX and are not flagged, matching `GITHUB_URL` in `SettingsAboutSection.tsx`), wrap only the offending lines with `{/* eslint-disable-next-line i18next/no-literal-string */}` exactly as `SettingsAboutSection.tsx` does. Do not disable the rule file-wide.

---

## Task 4: Wire the section into SettingsModal (above About)

**Files:**
- Modify: `frontend/src/components/SettingsModal.tsx`
- Modify: `frontend/src/test/settingsModal.test.tsx`

- [ ] **Step 1: Add the failing modal test**

In `frontend/src/test/settingsModal.test.tsx`, add this test inside the `describe('SettingsModal', ...)` block (e.g. after the existing `'lists the new Windows 95 and iPhone themes'` test):

```tsx
  it('renders the Handy Info section above About', () => {
    renderModal({ mobile: true });

    const handyToggle = screen.getByRole('button', { name: /Handy Info/i });
    const aboutToggle = screen.getByRole('button', { name: /^About$/i });

    // Both section toggles exist, and Handy Info comes before About in the DOM.
    expect(handyToggle).toBeInTheDocument();
    expect(aboutToggle).toBeInTheDocument();
    expect(
      handyToggle.compareDocumentPosition(aboutToggle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('applies an analyzer preset from the Handy Info section', async () => {
    const { onSaveAppSettings } = renderModal({ mobile: true });

    fireEvent.click(screen.getByRole('button', { name: /Handy Info/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Cornmeister' }));

    await waitFor(() => {
      expect(onSaveAppSettings).toHaveBeenCalledWith({
        analyzer_sites: [
          {
            name: 'Cornmeister',
            node_url_template: 'https://cornmeister.nl/#node?id={pubkey}',
            packet_url_template: null,
          },
        ],
      });
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/test/settingsModal.test.tsx -t "Handy Info"`
Expected: FAIL — no button named "Handy Info" (section not wired yet).

- [ ] **Step 3: Import the component**

In `SettingsModal.tsx`, add the import next to the other section imports (after the `SettingsAboutSection` import at line ~29):

```ts
import { SettingsHandyInfoSection } from './settings/SettingsHandyInfoSection';
```

- [ ] **Step 4: Add the section to expandedSections state**

In `SettingsModal.tsx`, update the `expandedSections` initial state to include `handy-info` (before `about`):

```ts
  const [expandedSections, setExpandedSections] = useState<Record<SettingsSection, boolean>>({
    radio: false,
    local: false,
    'radio-app': false,
    fanout: false,
    database: false,
    statistics: false,
    'handy-info': false,
    about: false,
  });
```

- [ ] **Step 5: Render the section directly above the About block**

In `SettingsModal.tsx`, immediately BEFORE the existing `{shouldRenderSection('about') && ( ... )}` block (line ~334), insert:

```tsx
      {shouldRenderSection('handy-info') && (
        <section className={sectionWrapperClass}>
          {renderSectionHeader('handy-info')}
          {isSectionVisible('handy-info') && (
            <SettingsHandyInfoSection
              appSettings={appSettings}
              onSaveAppSettings={onSaveAppSettings}
              className={sectionContentClass}
            />
          )}
        </section>
      )}

```

- [ ] **Step 6: Run the modal tests to verify they pass**

Run: `npm run test:run -- src/test/settingsModal.test.tsx`
Expected: PASS, including the two new Handy Info tests and all pre-existing tests.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS with no errors (the `expandedSections` Record is now complete).

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm run test:run`
Expected: PASS. Pay attention to `i18nParity`, `settingsHandyInfoSection`, `settingsModal`, and `settingsAboutSection` — all green.

- [ ] **Step 2: Typecheck the whole frontend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Runtime observation (required by CLAUDE.md — runtime must be observed, not reasoned about)**

Build/serve the frontend or use the project's local run flow, open Settings, and confirm by direct observation:
- A "Handy Info" section/sidebar entry appears directly above "About".
- The three groups render (analyzers, sync sources, reference links).
- Clicking an analyzer's **Apply** adds it (then shows as disabled "Added"); the entry also appears in the Database section's analyzer list.
- Clicking a sync **Apply** onto an already-set, different URL prompts a confirm.
- **Copy** places the URL on the clipboard.

Record what was observed (screenshots or a written pass/fail per bullet). If any bullet cannot be observed, write "NOT VERIFIED" against it rather than claiming success.

---

## Self-Review (completed during authoring)

- **Spec coverage:** section above About (Task 2 order + Task 4 render) ✓; component styled like the app (Task 3) ✓; analyzers with Copy/Apply-append-dedupe (Task 3 tests) ✓; sync sources with Apply + confirm-before-overwrite (Task 3 tests) ✓; reference links open-only incl. meshwiki (Task 3 render + test) ✓; i18n EN/NL/DE with parity (Task 1) ✓; tests incl. above-About (Task 4) ✓; no backend changes ✓.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `AnalyzerSite` shape `{ name, node_url_template, packet_url_template }` matches `types.ts:435`; `SyncField` values match `AppSettings` keys `region_sync_url` / `registry_sync_url`; `SettingsSection` union extended consistently across order/labels/icons/`expandedSections`; toast handles (`success`/`error`/`info`) exist on the re-exported sonner `toast`.
