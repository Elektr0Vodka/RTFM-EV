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
  {
    name: 'Cornmeister',
    site: 'https://cornmeister.nl',
    template: 'https://cornmeister.nl/#node?id={pubkey}',
  },
  {
    name: 'MC-Radar',
    site: 'https://mc-radar.woodwar.com',
    template: 'https://mc-radar.woodwar.com/node/{pubkey}',
  },
  {
    name: 'meshcore-analyzer.eu',
    site: 'https://meshcore-analyzer.eu',
    template: 'https://meshcore-analyzer.eu/#node?id={pubkey}',
  },
  {
    name: 'MeshCoreNetz',
    site: 'https://analyzer.meshcorenetz.de',
    template: 'https://analyzer.meshcorenetz.de/#node?id={pubkey}',
  },
  {
    name: 'MeshDresden',
    site: 'https://analyzer.meshdresden.eu',
    template: 'https://analyzer.meshdresden.eu/#node?id={pubkey}',
  },
];

type SyncField = 'region_sync_url' | 'registry_sync_url';

interface SyncSource {
  labelKey: string;
  field: SyncField;
  url: string;
}

const SYNC_SOURCES: SyncSource[] = [
  {
    labelKey: 'settings_handy_sync_region_label',
    field: 'region_sync_url',
    url: 'https://meshcore-analyzer.eu/api/regions/scopes',
  },
  {
    labelKey: 'settings_handy_sync_registry_label',
    field: 'registry_sync_url',
    url: 'https://meshcore-analyzer.eu/api/channels',
  },
];

interface ReferenceLink {
  labelKey: string;
  url: string;
}

const REFERENCE_LINKS: ReferenceLink[] = [
  {
    labelKey: 'settings_handy_link_dutch_settings_label',
    url: 'https://settings.dutchmeshcore.nl',
  },
  {
    labelKey: 'settings_handy_link_channel_browser_label',
    url: 'https://toolbox.dutchmeshcore.nl/#/channel-browser',
  },
  {
    labelKey: 'settings_handy_link_meshwiki_label',
    url: 'https://meshwiki.nl/wiki/Lijst_van_regio%27s',
  },
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
                      <Button variant="outline" size="sm">
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
