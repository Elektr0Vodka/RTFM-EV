import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { api } from '../../api';
import { useT } from '../../i18n';
import { MiniMap } from '../../map/MiniMap';
import { setTileProxyConfig } from '../../map/engine/tileProxy';
import type {
  TileAreaEstimate,
  TileAreaRequest,
  TileCacheConfig,
  TileCacheStats,
  TileDownloadStatus,
} from '../../types';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from '../ui/sonner';

const DEFAULT_AREA_CENTER: [number, number] = [5.1, 52.1];
const DEFAULT_MIN_ZOOM = 10;

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Settings > Map: backend tile cache (on/off, size, max age, stats, clear) and,
 *  for sources whose tile policy allows it, area pre-download. */
export function SettingsTileCacheSection() {
  const t = useT();
  const [config, setConfig] = useState<TileCacheConfig | null>(null);
  const [stats, setStats] = useState<TileCacheStats | null>(null);
  const [sizeDraft, setSizeDraft] = useState('');
  const [ageDraft, setAgeDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const applyConfig = useCallback((cfg: TileCacheConfig) => {
    setConfig(cfg);
    setTileProxyConfig(cfg);
    setSizeDraft(String(cfg.max_size_mb));
    setAgeDraft(String(cfg.max_age_days));
  }, []);

  const refreshStats = useCallback(() => {
    api
      .getTileCacheStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  useEffect(() => {
    api
      .getTileCacheConfig()
      .then(applyConfig)
      .catch((err) => toast.error(t('settings_tiles_load_failed'), { description: errText(err) }));
    refreshStats();
  }, [applyConfig, refreshStats, t]);

  const save = async (update: Parameters<typeof api.updateTileCacheConfig>[0]) => {
    setBusy(true);
    try {
      applyConfig(await api.updateTileCacheConfig(update));
      toast.success(t('settings_tiles_saved'));
      refreshStats();
    } catch (err) {
      toast.error(t('settings_tiles_save_failed'), { description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const saveLimits = () => {
    const size = Number.parseInt(sizeDraft, 10);
    const age = Number.parseInt(ageDraft, 10);
    if (!config || !Number.isFinite(size) || !Number.isFinite(age)) return;
    void save({ max_size_mb: size, max_age_days: age });
  };

  const clearCache = async () => {
    if (!window.confirm(t('settings_tiles_clear_confirm'))) return;
    setBusy(true);
    try {
      setStats(await api.clearTileCache());
      toast.success(t('settings_tiles_cleared'));
    } catch (err) {
      toast.error(t('settings_tiles_clear_failed'), { description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_tiles_heading')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_tiles_loading')}</p>
      </div>
    );
  }

  const downloadSources = config.sources.filter((s) => s.proxy && s.predownload);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_tiles_heading')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_tiles_description')}</p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
        <Checkbox
          id="tile-cache-enabled"
          checked={config.enabled}
          disabled={busy}
          onCheckedChange={(checked) => void save({ enabled: checked === true })}
          className="mt-0.5"
        />
        <div className="space-y-1">
          <Label htmlFor="tile-cache-enabled">{t('settings_tiles_enable_label')}</Label>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_tiles_enable_description')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="tile-cache-size">{t('settings_tiles_size_label')}</Label>
          <Input
            id="tile-cache-size"
            type="number"
            min={config.limits.min_size_mb}
            max={config.limits.max_size_mb}
            value={sizeDraft}
            onChange={(e) => setSizeDraft(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tile-cache-age">{t('settings_tiles_age_label')}</Label>
          <Input
            id="tile-cache-age"
            type="number"
            min={config.limits.min_age_days}
            max={config.limits.max_age_days}
            value={ageDraft}
            onChange={(e) => setAgeDraft(e.target.value)}
          />
        </div>
      </div>
      <Button type="button" size="sm" onClick={saveLimits} disabled={busy}>
        {t('settings_tiles_save_limits')}
      </Button>

      <div className="space-y-2 rounded-md border border-border/60 p-3">
        <div className="text-sm" data-testid="tile-cache-stats">
          {stats
            ? t('settings_tiles_stats', {
                entries: String(stats.entries),
                size: mb(stats.bytes),
                max: mb(stats.max_bytes),
              })
            : t('settings_tiles_stats_unavailable')}
        </div>
        <ul className="space-y-1 text-[0.8125rem] text-muted-foreground">
          {config.sources.map((s) => {
            const st = stats?.per_source[s.id];
            return (
              <li key={s.id}>
                <a
                  href={s.policy_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline"
                >
                  {s.label}
                </a>
                {': '}
                {s.proxy
                  ? t('settings_tiles_source_cached', {
                      entries: String(st?.entries ?? 0),
                      size: mb(st?.bytes ?? 0),
                    })
                  : t('settings_tiles_source_direct')}
                {s.proxy && !s.predownload && ` ${t('settings_tiles_source_no_download')}`}
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={refreshStats}>
            {t('settings_tiles_refresh_stats')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={clearCache} disabled={busy}>
            {t('settings_tiles_clear')}
          </Button>
        </div>
      </div>

      {downloadSources.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_tiles_download_none')}
        </p>
      ) : (
        <TileAreaDownload config={config} onFinished={refreshStats} />
      )}
    </div>
  );
}

/** Area pre-download for policy-allowed sources: the mini-map viewport is the area. */
function TileAreaDownload({
  config,
  onFinished,
}: {
  config: TileCacheConfig;
  onFinished: () => void;
}) {
  const t = useT();
  const sources = config.sources.filter((s) => s.proxy && s.predownload);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const source = sources.find((s) => s.id === sourceId) ?? sources[0];
  const zoomCap = Math.min(config.limits.predownload_max_zoom, source?.max_zoom ?? 0);
  const [minZoom, setMinZoom] = useState(Math.min(DEFAULT_MIN_ZOOM, zoomCap));
  const [maxZoom, setMaxZoom] = useState(zoomCap);
  const [bounds, setBounds] = useState<Omit<TileAreaRequest, 'source' | 'min_zoom' | 'max_zoom'>>();
  const [estimate, setEstimate] = useState<TileAreaEstimate | null>(null);
  const [status, setStatus] = useState<TileDownloadStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleReady = useCallback((map: MlMap) => {
    const capture = () => {
      const b = map.getBounds();
      setBounds({
        west: Math.max(-180, b.getWest()),
        south: Math.max(-85, b.getSouth()),
        east: Math.min(180, b.getEast()),
        north: Math.min(85, b.getNorth()),
      });
    };
    capture();
    map.on('moveend', capture);
  }, []);

  const area: TileAreaRequest | null =
    bounds && source
      ? { ...bounds, source: source.id, min_zoom: minZoom, max_zoom: maxZoom }
      : null;

  useEffect(() => {
    if (!area) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .estimateTileDownload(area)
        .then((e) => !cancelled && setEstimate(e))
        .catch(() => !cancelled && setEstimate(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Re-estimate when the area inputs change (area is rebuilt every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, source?.id, minZoom, maxZoom]);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const poll = useCallback(() => {
    api
      .getTileDownload()
      .then((s) => {
        setStatus(s);
        if (s.state !== 'running') {
          stopPolling();
          onFinished();
        }
      })
      .catch(() => stopPolling());
  }, [onFinished]);

  useEffect(() => {
    // Pick up a download that is already running (e.g. after reopening settings).
    poll();
    return stopPolling;
  }, [poll]);

  useEffect(() => {
    if (status?.state === 'running' && !pollRef.current) {
      pollRef.current = setInterval(poll, 1000);
    }
  }, [status?.state, poll]);

  const start = async () => {
    if (!area) return;
    try {
      setStatus(await api.startTileDownload(area));
    } catch (err) {
      toast.error(t('settings_tiles_download_failed'), { description: errText(err) });
    }
  };

  const cancel = async () => {
    try {
      setStatus(await api.cancelTileDownload());
    } catch (err) {
      toast.error(t('settings_tiles_download_failed'), { description: errText(err) });
    }
  };

  const running = status?.state === 'running';
  const zoomOptions = Array.from(
    { length: zoomCap - config.limits.predownload_min_zoom + 1 },
    (_, i) => config.limits.predownload_min_zoom + i
  );

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">{t('settings_tiles_download_heading')}</h4>
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('settings_tiles_download_description', {
          concurrency: String(config.limits.predownload_concurrency),
        })}
      </p>
      <div className="space-y-1">
        <Label htmlFor="tile-download-source">{t('settings_tiles_download_source')}</Label>
        <select
          id="tile-download-source"
          value={source?.id ?? ''}
          onChange={(e) => setSourceId(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div
        className="overflow-hidden rounded border border-border"
        style={{ height: 220 }}
        aria-label={t('settings_tiles_download_area_aria')}
      >
        <MiniMap center={DEFAULT_AREA_CENTER} zoom={DEFAULT_MIN_ZOOM} onReady={handleReady} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="tile-download-min">{t('settings_tiles_download_min_zoom')}</Label>
          <select
            id="tile-download-min"
            value={minZoom}
            onChange={(e) => setMinZoom(Number(e.target.value))}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {zoomOptions.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tile-download-max">{t('settings_tiles_download_max_zoom')}</Label>
          <select
            id="tile-download-max"
            value={maxZoom}
            onChange={(e) => setMaxZoom(Number(e.target.value))}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {zoomOptions.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      </div>
      {estimate && (
        <p className="text-sm" data-testid="tile-download-estimate">
          {t('settings_tiles_download_estimate', {
            tiles: String(estimate.tiles),
            max: String(estimate.max_tiles),
          })}
          {!estimate.allowed && estimate.reason ? ` (${estimate.reason})` : ''}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={start} disabled={running || !estimate?.allowed}>
          {t('settings_tiles_download_start')}
        </Button>
        {running && (
          <Button type="button" size="sm" variant="outline" onClick={cancel}>
            {t('settings_tiles_download_cancel')}
          </Button>
        )}
      </div>
      {status && status.state !== 'idle' && (
        <div className="space-y-1">
          <progress
            className="w-full"
            max={Math.max(1, status.total)}
            value={status.done + status.failed}
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_tiles_download_progress', {
              done: String(status.done),
              failed: String(status.failed),
              total: String(status.total),
              state: t(`settings_tiles_download_state_${status.state}`),
            })}
          </p>
        </div>
      )}
    </div>
  );
}
