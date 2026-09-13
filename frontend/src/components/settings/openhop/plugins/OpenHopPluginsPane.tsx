import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../../../api';
import type { HealthStatus, OpenHopCatalogueEntry, OpenHopPlugin } from '../../../../types';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';
import { PluginList } from './PluginList';
import { CatalogueList } from './CatalogueList';
import { PluginProgressLog } from './PluginProgressLog';

interface Props {
  health: HealthStatus | null;
}

type PluginsTab = 'installed' | 'catalogue';

/**
 * Detection- and config-gated OpenHop plugin manager: installed list + catalogue,
 * lifecycle/settings/logs/uninstall, catalogue install and update with a live log.
 */
export function OpenHopPluginsPane({ health }: Props) {
  const t = useT();
  const isOpenHop = health?.radio_device_info?.is_openhop ?? false;
  const [tab, setTab] = useState<PluginsTab>('installed');
  const [plugins, setPlugins] = useState<OpenHopPlugin[]>([]);
  const [catalogue, setCatalogue] = useState<OpenHopCatalogueEntry[] | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeOp, setActiveOp] = useState<string | null>(null);

  const classifyError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 409) {
        setNotConfigured(true);
      } else if (e instanceof ApiError && e.status === 503) {
        setUnavailable(true);
      } else {
        setError(t('openhop_plugins_load_failed'));
      }
    },
    [t]
  );

  const reload = useCallback(async () => {
    setError(null);
    setNotConfigured(false);
    setUnavailable(false);
    try {
      const res = await api.listOpenHopPlugins();
      setPlugins(res.plugins ?? []);
    } catch (e) {
      classifyError(e);
    } finally {
      setLoaded(true);
    }
  }, [classifyError]);

  const loadCatalogue = useCallback(
    async (refresh = false) => {
      setError(null);
      try {
        const res = await api.getOpenHopPluginCatalogue(refresh);
        setCatalogue(res.plugins ?? []);
      } catch (e) {
        classifyError(e);
      }
    },
    [classifyError]
  );

  useEffect(() => {
    if (isOpenHop) void reload();
  }, [isOpenHop, reload]);

  if (!isOpenHop) return null;
  if (!loaded) return null;
  if (notConfigured) {
    return <p className="text-xs text-muted-foreground">{t('openhop_plugins_configure_first')}</p>;
  }
  if (unavailable) {
    return <p className="text-xs text-muted-foreground">{t('openhop_plugins_unavailable')}</p>;
  }

  const openCatalogue = () => {
    setTab('catalogue');
    if (catalogue === null) void loadCatalogue();
  };
  const onOperate = (id: string) => setActiveOp(id);
  const onOpDone = () => {
    setActiveOp(null);
    void reload();
  };

  const tabBtn = (id: PluginsTab, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-md px-3 py-1 text-xs ' +
        (tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')
      }
      aria-pressed={tab === id}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {tabBtn('installed', t('openhop_plugins_tab_installed'), () => setTab('installed'))}
        {tabBtn('catalogue', t('openhop_plugins_tab_catalogue'), openCatalogue)}
        <div className="ml-auto">
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
            {t('openhop_plugins_refresh')}
          </Button>
        </div>
      </div>

      {tab === 'installed' ? (
        <PluginList
          plugins={plugins}
          onReload={() => void reload()}
          onOperate={onOperate}
          setError={setError}
        />
      ) : (
        <CatalogueList
          entries={catalogue ?? []}
          onOperate={onOperate}
          onRefresh={() => void loadCatalogue(true)}
        />
      )}

      {activeOp && <PluginProgressLog id={activeOp} onDone={onOpDone} />}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
