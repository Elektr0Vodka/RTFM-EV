import { useEffect, useState } from 'react';
import { api } from '../../../../api';
import type { OpenHopHardwareData } from '../../../../types';
import { useT } from '../../../../i18n';

function fmtBytes(n?: number): string {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function fmtUptime(seconds?: number): string {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function KvRows({ obj }: { obj: Record<string, unknown> }) {
  return (
    <div className="space-y-0.5">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 text-[11px]">
          <span className="text-muted-foreground">{k}</span>
          <span className="font-mono">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * OpenHop system/hardware pane: CPU, memory, disk, uptime tiles from the
 * node's psutil stats (auto-refreshed), plus a collapsible read-only analytics
 * section. All values are read defensively from the nested hardware shape.
 */
export function OpenHopSystemPane() {
  const t = useT();
  const [hw, setHw] = useState<OpenHopHardwareData | null>(null);
  const [hwError, setHwError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await api.getOpenHopHardware();
        if (!active) return;
        if (r.success && r.data) {
          setHw(r.data);
          setHwError(null);
        } else {
          setHwError(r.error ?? t('openhop_sys_no_psutil'));
        }
      } catch (e) {
        if (active) setHwError(String(e));
      }
    };
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [t]);

  const loadAnalytics = async () => {
    try {
      const [packets, types, noise] = await Promise.all([
        api.getOpenHopPacketStats(24),
        api.getOpenHopPacketTypeStats(24),
        api.getOpenHopNoiseFloorStats(24),
      ]);
      setAnalytics({
        packet_stats: packets.data ?? {},
        packet_type_stats: types.data ?? {},
        noise_floor_stats: noise.data ?? {},
      });
    } catch (e) {
      setAnalytics({ error: String(e) });
    }
  };

  return (
    <div className="space-y-3 text-sm">
      {hwError && <div className="text-xs text-destructive">{hwError}</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label={t('openhop_sys_cpu')}
          value={hw?.cpu?.usage_percent != null ? `${hw.cpu.usage_percent.toFixed(1)}%` : '—'}
          sub={hw?.cpu?.load_avg?.['1min'] != null ? `load ${hw.cpu.load_avg['1min']}` : undefined}
        />
        <Tile
          label={t('openhop_sys_memory')}
          value={hw?.memory?.usage_percent != null ? `${hw.memory.usage_percent}%` : '—'}
          sub={`${fmtBytes(hw?.memory?.used)} / ${fmtBytes(hw?.memory?.total)}`}
        />
        <Tile
          label={t('openhop_sys_disk')}
          value={hw?.disk?.usage_percent != null ? `${hw.disk.usage_percent}%` : '—'}
          sub={`${fmtBytes(hw?.disk?.free)} ${t('openhop_sys_free')}`}
        />
        <Tile label={t('openhop_sys_uptime')} value={fmtUptime(hw?.system?.uptime)} />
      </div>

      <details className="rounded-md border border-border p-2">
        <summary
          className="cursor-pointer text-xs text-muted-foreground"
          onClick={() => {
            if (!analytics) void loadAnalytics();
          }}
        >
          {t('openhop_sys_analytics')}
        </summary>
        {analytics && (
          <div className="mt-2">
            <KvRows obj={analytics} />
          </div>
        )}
      </details>
    </div>
  );
}
