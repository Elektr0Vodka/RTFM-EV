/**
 * MyNodeView.tsx
 *
 * Node analytics page for the connected radio.
 * Uses buildRawPacketStatsSnapshot for rich session stats,
 * and /api/packets/timeseries for historical chart data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BatterySample,
  Contact,
  HealthStatus,
  NoiseFloorSample,
  RadioConfig,
  RawPacket,
  StatisticsResponse,
} from '../types';
import { mvToPercent } from '../utils/batteryDisplay';
import { api } from '../api';
import { buildRawPacketStatsSnapshot } from '../utils/rawPacketStats';
import { useRawPackets, useRawPacketStatsSession } from '../stores/rawPacketStore';
import { getContactDisplayName } from '../utils/pubkey';
import { cn } from '@/lib/utils';
import { useT, type TFn } from '../i18n';

// MeshCore node types (contact.type): translation key per mesh vocabulary label.
const NODE_TYPE_KEYS: Record<number, string> = {
  1: 'node_type_companion',
  2: 'common_repeater',
  3: 'common_room_server',
  4: 'common_sensor',
};

function nodeTypeLabel(type: number | null | undefined, t: TFn): string {
  const key = type != null ? NODE_TYPE_KEYS[type] : undefined;
  return key ? t(key) : t('common_unknown');
}

// ─── Props ─────────────────────────────────────────────────────────────────

interface Props {
  contacts: Contact[];
}

// ─── Time window definitions ────────────────────────────────────────────────

interface TimeWindow {
  key: string;
  label: string;
  seconds: number | null;
  useLive: boolean;
}

interface HistoricalNeighbor {
  public_key: string;
  name: string | null;
  heard_count: number;
  first_seen: number | null;
  last_seen: number | null;
  lat: number | null;
  lon: number | null;
  min_path_len: number | null;
  best_rssi?: number | null;
}

interface HistoricalBusiestChannel {
  channel_key: string;
  channel_name: string | null;
  message_count: number;
}

interface HistoricalStatsResponse {
  start_ts: number;
  end_ts: number;
  total_packets: number;
  total_bytes: number;
  packets_per_minute: number;
  avg_rssi: number | null;
  avg_snr: number | null;
  best_rssi: number | null;
  type_counts: Record<string, number>;
  has_signal_data: boolean;
  has_type_data: boolean;
  neighbors_by_count: HistoricalNeighbor[];
  neighbors_by_signal: HistoricalNeighbor[];
  busiest_channels?: HistoricalBusiestChannel[];
}

const TIME_WINDOWS: TimeWindow[] = [
  { key: '20m', label: '20m', seconds: 20 * 60, useLive: true },
  { key: '1h', label: '1h', seconds: 60 * 60, useLive: false },
  { key: '6h', label: '6h', seconds: 6 * 60 * 60, useLive: false },
  { key: '1d', label: '1d', seconds: 24 * 60 * 60, useLive: false },
  { key: '7d', label: '7d', seconds: 7 * 24 * 60 * 60, useLive: false },
  { key: '30d', label: '30d', seconds: 30 * 24 * 60 * 60, useLive: false },
  { key: '1y', label: '1y', seconds: 365 * 24 * 60 * 60, useLive: false },
  { key: 'custom', label: 'Custom', seconds: null, useLive: false },
];

const DEFAULT_WINDOW = TIME_WINDOWS[0];
const BIN_COUNT = 40;

// ─── Data types ─────────────────────────────────────────────────────────────

interface Bin {
  time: number;
  packets: number;
  bytes: number;
  types: Record<string, number>;
  snrs: number[];
  rssis: number[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function relTime(unixSec: number | null | undefined, t: TFn): string {
  if (unixSec == null) return t('node_time_never');
  const d = Date.now() - unixSec * 1000;
  if (d < 0) return t('channel_registry_just_now');
  const s = Math.floor(d / 1000);
  if (s < 60) return t('node_time_seconds_ago', { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('channel_registry_minutes_ago', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('channel_registry_hours_ago', { count: h });
  return t('channel_registry_days_ago', { count: Math.floor(h / 24) });
}

function fmtTime(ms: number, windowSeconds: number): string {
  const d = new Date(ms);
  if (windowSeconds <= 3600)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (windowSeconds <= 7 * 24 * 3600)
    return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function hexBytes(hex: string): number {
  return Math.floor(hex.length / 2);
}
function mean(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function buildLiveBins(packets: RawPacket[], windowMs: number): Bin[] {
  const now = Date.now();
  const start = now - windowMs;
  const binMs = windowMs / BIN_COUNT;
  const bins: Bin[] = Array.from({ length: BIN_COUNT }, (_, i) => ({
    time: start + i * binMs,
    packets: 0,
    bytes: 0,
    types: {},
    snrs: [],
    rssis: [],
  }));
  for (const pkt of packets) {
    const ts = pkt.timestamp * 1000;
    if (ts < start || ts > now) continue;
    const idx = Math.min(Math.floor((ts - start) / binMs), BIN_COUNT - 1);
    const b = bins[idx];
    b.packets++;
    b.bytes += hexBytes(pkt.data);
    b.types[pkt.payload_type] = (b.types[pkt.payload_type] ?? 0) + 1;
    if (pkt.snr != null) b.snrs.push(pkt.snr);
    if (pkt.rssi != null) b.rssis.push(pkt.rssi);
  }
  return bins;
}

// Compact time-window abbreviations are treated as locale-invariant unit
// shorthand (matching e.g. map_preset_7d / map_lt_1h elsewhere), so the same
// key text is used across en/nl/de; only the "Custom" preset is real prose.
const WINDOW_LABEL_KEYS: Record<string, string> = {
  '20m': 'node_window_20m',
  '1h': 'node_window_1h',
  '6h': 'node_window_6h',
  '1d': 'node_window_1d',
  '7d': 'node_window_7d',
  '30d': 'node_window_30d',
  '1y': 'node_window_1y',
  custom: 'settings_radio_preset_custom',
};

function windowLabel(key: string, t: TFn): string {
  const labelKey = WINDOW_LABEL_KEYS[key];
  return labelKey ? t(labelKey) : key;
}

function fmtWindowLabel(windowKey: string, customStart: string, customEnd: string, t: TFn): string {
  if (windowKey !== 'custom') {
    return t('node_window_last', { label: windowLabel(windowKey, t) });
  }
  if (customStart && customEnd) {
    const s = new Date(customStart).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const e = new Date(customEnd).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${s} – ${e}`;
  }
  return t('node_window_custom_range');
}

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
function fmtRssi(v: number | null, t: TFn): string {
  return v == null ? '—' : t('node_value_dbm', { value: Math.round(v) });
}

function fmtBytes(bytes: number, t: TFn): string {
  if (bytes < 1024) return t('node_value_bytes_compact', { value: bytes });
  if (bytes < 1024 * 1024) return t('node_value_kb_compact', { value: (bytes / 1024).toFixed(1) });
  return t('node_value_mb_compact', { value: (bytes / (1024 * 1024)).toFixed(2) });
}

// ─── Packet type colours ────────────────────────────────────────────────────
// Hardcoded HSL values (~28° steps around the hue wheel) so colours are vivid
// and distinct regardless of which theme is active.

const NAMED_TYPE_COLORS: Record<string, string> = {
  // All PayloadType enum values by exact name
  REQUEST: 'hsl(4,   70%, 54%)', // red
  RESPONSE: 'hsl(28,  82%, 54%)', // orange
  TEXT_MESSAGE: 'hsl(48,  85%, 46%)', // amber
  ACK: 'hsl(135, 60%, 44%)', // green
  ADVERT: 'hsl(192, 78%, 46%)', // cyan
  GROUP_TEXT: 'hsl(255, 65%, 60%)', // violet
  GROUP_DATA: 'hsl(310, 62%, 56%)', // magenta
  ANON_REQUEST: 'hsl(336, 70%, 56%)', // rose
  PATH: 'hsl(158, 62%, 42%)', // teal-green
  TRACE: 'hsl(22,  80%, 52%)', // burnt orange
  MULTIPART: 'hsl(222, 68%, 58%)', // indigo-blue
  CONTROL: 'hsl(282, 58%, 54%)', // purple
  RAW_CUSTOM: 'hsl(82,  58%, 44%)', // lime
  // Legacy / alternate spellings that may appear in older data
  GROUPTEXT: 'hsl(255, 65%, 60%)',
  TEXTMESSAGE: 'hsl(48,  85%, 46%)',
};

// Fallback palette for any unknown future types — 8 evenly-spaced hues
const FALLBACK_COLORS = [
  'hsl(0,   65%, 52%)',
  'hsl(45,  78%, 48%)',
  'hsl(90,  55%, 44%)',
  'hsl(135, 58%, 44%)',
  'hsl(180, 68%, 42%)',
  'hsl(225, 65%, 56%)',
  'hsl(270, 60%, 56%)',
  'hsl(315, 62%, 54%)',
];

function typeColor(t: string): string {
  const upper = t.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (upper in NAMED_TYPE_COLORS) return NAMED_TYPE_COLORS[upper];
  // Partial-match fallback for any prefixed/suffixed variants
  for (const [k, v] of Object.entries(NAMED_TYPE_COLORS)) {
    if (upper.includes(k) || k.includes(upper)) return v;
  }
  let hash = 0;
  for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

// ─── SVG chart constants ────────────────────────────────────────────────────

const CW = 300;
const CH = 70;
const PAD_L = 28;
const PAD_B = 16;
const INNER_W = CW - PAD_L;
const INNER_H = CH - PAD_B;

// ─── BarChart ──────────────────────────────────────────────────────────────

function BarChart({
  bins,
  valueKey,
  color = 'hsl(var(--primary))',
  formatY,
  id,
  tooltipLabel,
  windowSeconds,
}: {
  bins: Bin[];
  valueKey: 'packets' | 'bytes';
  color?: string;
  formatY?: (v: number) => string;
  id: string;
  tooltipLabel?: string;
  windowSeconds: number;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const values = bins.map((b) => b[valueKey]);
  const max = Math.max(...values, 1);
  const barW = (INNER_W / values.length) * 0.6;
  const gap = INNER_W / values.length;
  const yLabels = [0, Math.round(max / 2), max];
  const showIdx = [0, Math.floor(values.length / 2), values.length - 1];
  const hovV = hov != null ? values[hov] : null;
  const hovX = hov != null ? PAD_L + hov * gap + gap / 2 : 0;
  let tipX = hovX;
  let tipY = INNER_H - (hovV != null ? Math.max(0, (hovV / max) * INNER_H) : 0) - 16;
  if (tipX < PAD_L + 24) tipX = PAD_L + 24;
  if (tipX > CW - 24) tipX = CW - 24;
  if (tipY < 0) tipY = 2;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CW} ${CH}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.9" />
          <stop offset="100%" stopColor={color} stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={`${id}-h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.7" />
        </linearGradient>
      </defs>
      {yLabels.map((v) => {
        const y = INNER_H - (v / max) * INNER_H;
        return (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={CW}
              y1={y.toFixed(1)}
              y2={y.toFixed(1)}
              stroke="hsl(var(--border))"
              strokeWidth="0.5"
              strokeDasharray="2,2"
            />
            <text
              x={PAD_L - 3}
              y={y.toFixed(1)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="8"
              fill="hsl(var(--muted-foreground))"
            >
              {formatY ? formatY(v) : v}
            </text>
          </g>
        );
      })}
      {values.map((v, i) => {
        const bH = Math.max(0, (v / max) * INNER_H);
        const x = PAD_L + i * gap + (gap - barW) / 2;
        return (
          <rect
            key={i}
            x={x.toFixed(1)}
            y={(INNER_H - bH).toFixed(1)}
            width={barW.toFixed(1)}
            height={bH.toFixed(1)}
            fill={hov === i ? `url(#${id}-h)` : `url(#${id})`}
            rx="1"
          />
        );
      })}
      <line
        x1={PAD_L}
        x2={CW}
        y1={INNER_H}
        y2={INNER_H}
        stroke="hsl(var(--border))"
        strokeWidth="0.5"
      />
      {showIdx.map((i) => (
        <text
          key={i}
          x={(PAD_L + i * gap + gap / 2).toFixed(1)}
          y={CH - 2}
          textAnchor={i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'}
          fontSize="7"
          fill="hsl(var(--muted-foreground))"
        >
          {fmtTime(bins[i].time, windowSeconds)}
        </text>
      ))}
      {hov !== null && hovV !== null && (
        <g transform={`translate(${tipX.toFixed(1)},${tipY.toFixed(1)})`}>
          <rect
            x="-28"
            y="-11"
            width="56"
            height="22"
            rx="2"
            fill="hsl(var(--popover))"
            stroke="hsl(var(--border))"
            strokeWidth="0.5"
            style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}
          />
          <text
            textAnchor="middle"
            y="1"
            fontSize="8.5"
            fontWeight="600"
            fill="hsl(var(--popover-foreground))"
          >
            {formatY ? formatY(hovV) : String(hovV)}
          </text>
          <text textAnchor="middle" fontSize="6.5" fill="hsl(var(--muted-foreground))" dy="-12">
            {tooltipLabel ? `${tooltipLabel} · ` : ''}
            {fmtTime(bins[hov].time, windowSeconds)}
          </text>
        </g>
      )}
      {values.map((_, i) => (
        <rect
          key={i}
          x={(PAD_L + i * gap).toFixed(1)}
          y="0"
          width={gap.toFixed(1)}
          height={`${INNER_H}`}
          fill="transparent"
          onMouseEnter={() => setHov(i)}
          onMouseLeave={() => setHov(null)}
        />
      ))}
    </svg>
  );
}

// ─── LineChart ─────────────────────────────────────────────────────────────

function LineChart({
  bins,
  valueKey,
  color = 'hsl(var(--primary))',
  formatY,
  id,
  tooltipLabel,
  windowSeconds,
  t,
}: {
  bins: Bin[];
  valueKey: 'snr' | 'rssi';
  color?: string;
  formatY?: (v: number) => string;
  id: string;
  tooltipLabel?: string;
  windowSeconds: number;
  t: TFn;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const values = bins.map((b): number | null =>
    valueKey === 'snr' ? mean(b.snrs) : mean(b.rssis)
  );
  const nonNull = values.filter((v): v is number => v != null);
  const gap = INNER_W / values.length;
  function xPos(i: number) {
    return PAD_L + i * gap + gap / 2;
  }

  if (nonNull.length < 2)
    return (
      <svg width="100%" viewBox={`0 0 ${CW} ${CH}`} style={{ display: 'block' }}>
        <text
          x={(PAD_L + INNER_W / 2).toFixed(1)}
          y={(CH / 2).toFixed(1)}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="hsl(var(--muted-foreground))"
        >
          {t('node_chart_no_data')}
        </text>
        {[0, Math.floor(values.length / 2), values.length - 1].map((i) => (
          <text
            key={i}
            x={xPos(i).toFixed(1)}
            y={CH - 2}
            textAnchor={i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'}
            fontSize="7"
            fill="hsl(var(--muted-foreground))"
          >
            {fmtTime(bins[i].time, windowSeconds)}
          </text>
        ))}
      </svg>
    );

  const yMin = Math.min(...nonNull);
  const yMax = Math.max(...nonNull);
  const range = yMax - yMin || 1;
  const yLabels = [yMin, (yMin + yMax) / 2, yMax].map(Math.round);
  function yPos(v: number) {
    return INNER_H - ((v - yMin) / range) * INNER_H;
  }

  let linePath = '';
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    linePath += `${i === 0 || values[i - 1] == null ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`;
  }
  let areaPath = '';
  let segStart: number | null = null;
  for (let i = 0; i <= values.length; i++) {
    const v = values[i] ?? null;
    if (v != null && segStart == null) segStart = i;
    if ((v == null || i === values.length) && segStart != null) {
      const end = i - 1;
      const pts = [];
      for (let j = segStart; j <= end; j++)
        pts.push(`${xPos(j).toFixed(1)},${yPos(values[j]!).toFixed(1)}`);
      areaPath += `M${xPos(segStart).toFixed(1)},${INNER_H} L${pts.join(' L')} L${xPos(end).toFixed(1)},${INNER_H} Z `;
      segStart = null;
    }
  }

  let tipX = 0,
    tipY = 0;
  let tipVal: number | null = null;
  if (hov !== null) {
    tipVal = values[hov] ?? null;
    tipX = xPos(hov);
    tipY = tipVal != null ? yPos(tipVal) - 20 : 10;
    if (tipX < PAD_L + 28) tipX = PAD_L + 28;
    if (tipX > CW - 28) tipX = CW - 28;
    if (tipY < 2) tipY = 2;
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CW} ${CH}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yLabels.map((v, li) => {
        const y = yPos(v);
        return (
          <g key={li}>
            <line
              x1={PAD_L}
              x2={CW}
              y1={y.toFixed(1)}
              y2={y.toFixed(1)}
              stroke="hsl(var(--border))"
              strokeWidth="0.5"
              strokeDasharray="2,2"
            />
            <text
              x={PAD_L - 3}
              y={y.toFixed(1)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="8"
              fill="hsl(var(--muted-foreground))"
            >
              {formatY ? formatY(v) : v}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill={`url(#${id})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {hov !== null && tipVal != null && (
        <circle
          cx={xPos(hov).toFixed(1)}
          cy={yPos(tipVal).toFixed(1)}
          r="3"
          fill={color}
          stroke="hsl(var(--background))"
          strokeWidth="1.5"
        />
      )}
      {hov !== null && tipVal !== null && (
        <g transform={`translate(${tipX.toFixed(1)},${tipY.toFixed(1)})`}>
          <rect
            x="-28"
            y="-11"
            width="56"
            height="22"
            rx="2"
            fill="hsl(var(--popover))"
            stroke="hsl(var(--border))"
            strokeWidth="0.5"
            style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}
          />
          <text
            textAnchor="middle"
            y="1"
            fontSize="8.5"
            fontWeight="600"
            fill="hsl(var(--popover-foreground))"
          >
            {formatY ? formatY(tipVal) : String(Math.round(tipVal))}
          </text>
          <text textAnchor="middle" fontSize="6.5" fill="hsl(var(--muted-foreground))" dy="-12">
            {tooltipLabel ? `${tooltipLabel} · ` : ''}
            {fmtTime(bins[hov].time, windowSeconds)}
          </text>
        </g>
      )}
      <line
        x1={PAD_L}
        x2={CW}
        y1={INNER_H}
        y2={INNER_H}
        stroke="hsl(var(--border))"
        strokeWidth="0.5"
      />
      {[0, Math.floor(values.length / 2), values.length - 1].map((i) => (
        <text
          key={i}
          x={xPos(i).toFixed(1)}
          y={CH - 2}
          textAnchor={i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'}
          fontSize="7"
          fill="hsl(var(--muted-foreground))"
        >
          {fmtTime(bins[i].time, windowSeconds)}
        </text>
      ))}
      {values.map((_, i) => (
        <rect
          key={i}
          x={(PAD_L + i * gap).toFixed(1)}
          y="0"
          width={gap.toFixed(1)}
          height={`${INNER_H}`}
          fill="transparent"
          onMouseEnter={() => setHov(i)}
          onMouseLeave={() => setHov(null)}
        />
      ))}
    </svg>
  );
}

// ─── StackedBarChart ────────────────────────────────────────────────────────

function StackedBarChart({
  bins,
  windowSeconds,
  t,
}: {
  bins: Bin[];
  windowSeconds: number;
  t: TFn;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const allTypes = [...new Set(bins.flatMap((b) => Object.keys(b.types)))];
  const maxTotal = Math.max(...bins.map((b) => b.packets), 1);
  const gap = INNER_W / bins.length;
  const barW = gap * 0.6;
  const showIdx = [0, Math.floor(bins.length / 2), bins.length - 1];
  const hovBin = hov != null ? bins[hov] : null;
  const hovX = hov != null ? PAD_L + hov * gap + gap / 2 : 0;
  let tipX = hovX;
  const tipY = hovBin ? Math.max(4, INNER_H - (hovBin.packets / maxTotal) * INNER_H - 24) : 4;
  if (tipX < PAD_L + 36) tipX = PAD_L + 36;
  if (tipX > CW - 36) tipX = CW - 36;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CW} ${CH}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <line
        x1={PAD_L}
        x2={CW}
        y1={INNER_H}
        y2={INNER_H}
        stroke="hsl(var(--border))"
        strokeWidth="0.5"
      />
      <text
        x={PAD_L - 3}
        y={0}
        textAnchor="end"
        dominantBaseline="hanging"
        fontSize="8"
        fill="hsl(var(--muted-foreground))"
      >
        {maxTotal}
      </text>
      <text
        x={PAD_L - 3}
        y={INNER_H}
        textAnchor="end"
        dominantBaseline="auto"
        fontSize="8"
        fill="hsl(var(--muted-foreground))"
      >
        0
      </text>
      {bins.map((bin, i) => {
        const x = PAD_L + i * gap + (gap - barW) / 2;
        let yOff = INNER_H;
        return allTypes.map((pt) => {
          const count = bin.types[pt] ?? 0;
          if (!count) return null;
          const h = (count / maxTotal) * INNER_H;
          yOff -= h;
          return (
            <rect
              key={pt}
              x={x.toFixed(1)}
              y={yOff.toFixed(1)}
              width={barW.toFixed(1)}
              height={h.toFixed(1)}
              fill={typeColor(pt)}
              fillOpacity={hov === i ? 1 : 0.85}
              rx="0.5"
            />
          );
        });
      })}
      {showIdx.map((i) => (
        <text
          key={i}
          x={(PAD_L + i * gap + gap / 2).toFixed(1)}
          y={CH - 2}
          textAnchor={i === 0 ? 'start' : i === bins.length - 1 ? 'end' : 'middle'}
          fontSize="7"
          fill="hsl(var(--muted-foreground))"
        >
          {fmtTime(bins[i].time, windowSeconds)}
        </text>
      ))}
      {hovBin && hovBin.packets > 0 && (
        <g transform={`translate(${tipX.toFixed(1)},${tipY.toFixed(1)})`}>
          <rect
            x="-36"
            y="-2"
            width="72"
            height={`${10 + Object.keys(hovBin.types).length * 9}`}
            rx="2"
            fill="hsl(var(--popover))"
            stroke="hsl(var(--border))"
            strokeWidth="0.5"
            style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}
          />
          <text
            textAnchor="middle"
            y="8"
            fontSize="8"
            fontWeight="600"
            fill="hsl(var(--popover-foreground))"
          >
            {t('node_pkts_time_suffix', {
              count: hovBin.packets,
              time: fmtTime(hovBin.time, windowSeconds),
            })}
          </text>
          {Object.entries(hovBin.types).map(([pt, c], ti) => (
            <text
              key={pt}
              textAnchor="middle"
              y={`${17 + ti * 9}`}
              fontSize="7"
              fill={typeColor(pt)}
            >
              {pt}: {c}
            </text>
          ))}
        </g>
      )}
      {bins.map((_, i) => (
        <rect
          key={i}
          x={(PAD_L + i * gap).toFixed(1)}
          y="0"
          width={gap.toFixed(1)}
          height={`${INNER_H}`}
          fill="transparent"
          onMouseEnter={() => setHov(i)}
          onMouseLeave={() => setHov(null)}
        />
      ))}
    </svg>
  );
}

// ─── NoiseFloorLineChart ────────────────────────────────────────────────────

function NoiseFloorLineChart({
  samples,
  windowSeconds,
  t,
}: {
  samples: NoiseFloorSample[];
  windowSeconds: number;
  t: TFn;
}) {
  const [hov, setHov] = useState<number | null>(null);
  if (samples.length < 2)
    return (
      <svg width="100%" viewBox={`0 0 ${CW} ${CH}`} style={{ display: 'block' }}>
        <text
          x={(PAD_L + INNER_W / 2).toFixed(1)}
          y={(CH / 2).toFixed(1)}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="hsl(var(--muted-foreground))"
        >
          {samples.length === 0 ? t('node_chart_no_data') : t('node_chart_need_more_samples')}
        </text>
      </svg>
    );

  const values = samples.map((s) => s.noise_floor_dbm);
  const timestamps = samples.map((s) => s.timestamp * 1000);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const range = yMax - yMin || 1;
  const tMin = timestamps[0];
  const tMax = timestamps[timestamps.length - 1];
  const tRange = tMax - tMin || 1;
  const color = '#8b5cf6';
  const id = 'noise-floor-grad';

  function xPos(i: number): number {
    return PAD_L + ((timestamps[i] - tMin) / tRange) * INNER_W;
  }
  function yPos(v: number): number {
    return INNER_H - ((v - yMin) / range) * INNER_H;
  }

  const yLabels = [yMin, Math.round((yMin + yMax) / 2), yMax];

  let linePath = '';
  let areaPath = `M${xPos(0).toFixed(1)},${INNER_H} `;
  for (let i = 0; i < samples.length; i++) {
    const x = xPos(i).toFixed(1);
    const y = yPos(values[i]).toFixed(1);
    linePath += `${i === 0 ? 'M' : 'L'}${x},${y}`;
    areaPath += `L${x},${y} `;
  }
  areaPath += `L${xPos(samples.length - 1).toFixed(1)},${INNER_H} Z`;

  const showIdx = [0, Math.floor(samples.length / 2), samples.length - 1];

  let tipX = 0,
    tipY = 0,
    tipVal: number | null = null;
  if (hov !== null) {
    tipVal = values[hov];
    tipX = xPos(hov);
    tipY = yPos(tipVal) - 20;
    if (tipX < PAD_L + 28) tipX = PAD_L + 28;
    if (tipX > CW - 28) tipX = CW - 28;
    if (tipY < 2) tipY = 2;
  }

  const hovZoneW = INNER_W / samples.length;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CW} ${CH}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yLabels.map((v, li) => {
        const y = yPos(v);
        return (
          <g key={li}>
            <line
              x1={PAD_L}
              x2={CW}
              y1={y.toFixed(1)}
              y2={y.toFixed(1)}
              stroke="hsl(var(--border))"
              strokeWidth="0.5"
              strokeDasharray="2,2"
            />
            <text
              x={PAD_L - 3}
              y={y.toFixed(1)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="8"
              fill="hsl(var(--muted-foreground))"
            >
              {v}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill={`url(#${id})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {hov !== null && tipVal != null && (
        <circle
          cx={xPos(hov).toFixed(1)}
          cy={yPos(tipVal).toFixed(1)}
          r="3"
          fill={color}
          stroke="hsl(var(--background))"
          strokeWidth="1.5"
        />
      )}
      {hov !== null && tipVal !== null && (
        <g transform={`translate(${tipX.toFixed(1)},${tipY.toFixed(1)})`}>
          <rect
            x="-28"
            y="-11"
            width="56"
            height="22"
            rx="2"
            fill="hsl(var(--popover))"
            stroke="hsl(var(--border))"
            strokeWidth="0.5"
            style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}
          />
          <text
            textAnchor="middle"
            y="1"
            fontSize="8.5"
            fontWeight="600"
            fill="hsl(var(--popover-foreground))"
          >
            {t('node_value_dbm', { value: tipVal })}
          </text>
          <text textAnchor="middle" fontSize="6.5" fill="hsl(var(--muted-foreground))" dy="-12">
            {t('node_tooltip_time_suffix', {
              label: t('node_tooltip_noise_floor'),
              time: fmtTime(timestamps[hov], windowSeconds),
            })}
          </text>
        </g>
      )}
      <line
        x1={PAD_L}
        x2={CW}
        y1={INNER_H}
        y2={INNER_H}
        stroke="hsl(var(--border))"
        strokeWidth="0.5"
      />
      {showIdx.map((i) => (
        <text
          key={i}
          x={xPos(i).toFixed(1)}
          y={CH - 2}
          textAnchor={i === 0 ? 'start' : i === samples.length - 1 ? 'end' : 'middle'}
          fontSize="7"
          fill="hsl(var(--muted-foreground))"
        >
          {fmtTime(timestamps[i], windowSeconds)}
        </text>
      ))}
      {samples.map((_, i) => (
        <rect
          key={i}
          x={(PAD_L + i * hovZoneW).toFixed(1)}
          y="0"
          width={hovZoneW.toFixed(1)}
          height={`${INNER_H}`}
          fill="transparent"
          onMouseEnter={() => setHov(i)}
          onMouseLeave={() => setHov(null)}
        />
      ))}
    </svg>
  );
}

// ─── BatteryLineChart ───────────────────────────────────────────────────────

function BatteryLineChart({
  samples,
  windowSeconds,
  t,
}: {
  samples: BatterySample[];
  windowSeconds: number;
  t: TFn;
}) {
  const [hov, setHov] = useState<number | null>(null);
  if (samples.length < 2)
    return (
      <svg width="100%" viewBox={`0 0 ${CW} ${CH}`} style={{ display: 'block' }}>
        <text
          x={(PAD_L + INNER_W / 2).toFixed(1)}
          y={(CH / 2).toFixed(1)}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="hsl(var(--muted-foreground))"
        >
          {samples.length === 0 ? t('node_chart_no_data') : t('node_chart_need_more_samples')}
        </text>
      </svg>
    );

  const values = samples.map((s) => s.battery_mv);
  const timestamps = samples.map((s) => s.timestamp * 1000);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const range = yMax - yMin || 1;
  const tMin = timestamps[0];
  const tMax = timestamps[timestamps.length - 1];
  const tRange = tMax - tMin || 1;
  const color = '#22c55e';
  const id = 'battery-grad';

  function xPos(i: number): number {
    return PAD_L + ((timestamps[i] - tMin) / tRange) * INNER_W;
  }
  function yPos(v: number): number {
    return INNER_H - ((v - yMin) / range) * INNER_H;
  }

  const yLabels = [yMin, Math.round((yMin + yMax) / 2), yMax];

  let linePath = '';
  let areaPath = `M${xPos(0).toFixed(1)},${INNER_H} `;
  for (let i = 0; i < samples.length; i++) {
    const x = xPos(i).toFixed(1);
    const y = yPos(values[i]).toFixed(1);
    linePath += `${i === 0 ? 'M' : 'L'}${x},${y}`;
    areaPath += `L${x},${y} `;
  }
  areaPath += `L${xPos(samples.length - 1).toFixed(1)},${INNER_H} Z`;

  const showIdx = [0, Math.floor(samples.length / 2), samples.length - 1];

  let tipX = 0,
    tipY = 0,
    tipVal: number | null = null;
  if (hov !== null) {
    tipVal = values[hov];
    tipX = xPos(hov);
    tipY = yPos(tipVal) - 20;
    if (tipX < PAD_L + 28) tipX = PAD_L + 28;
    if (tipX > CW - 28) tipX = CW - 28;
    if (tipY < 2) tipY = 2;
  }

  const hovZoneW = INNER_W / samples.length;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CW} ${CH}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
        <clipPath id="battery-clip">
          <rect x={PAD_L} y="0" width={INNER_W} height={INNER_H} />
        </clipPath>
      </defs>

      {/* Y-axis labels */}
      {yLabels.map((v, i) => (
        <text
          key={i}
          x={PAD_L - 3}
          y={yPos(v).toFixed(1)}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize="7"
          fill="hsl(var(--muted-foreground))"
        >
          {t('node_value_v_compact', { value: (v / 1000).toFixed(2) })}
        </text>
      ))}

      {/* Grid lines */}
      {yLabels.map((v, i) => (
        <line
          key={i}
          x1={PAD_L}
          x2={CW}
          y1={yPos(v).toFixed(1)}
          y2={yPos(v).toFixed(1)}
          stroke="hsl(var(--border))"
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />
      ))}

      {/* Area fill */}
      <path d={areaPath} fill={`url(#${id})`} clipPath="url(#battery-clip)" />

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        clipPath="url(#battery-clip)"
      />

      {/* Hover dot */}
      {hov !== null && (
        <circle
          cx={xPos(hov).toFixed(1)}
          cy={yPos(values[hov]).toFixed(1)}
          r="3"
          fill={color}
          stroke="hsl(var(--popover))"
          strokeWidth="1.5"
        />
      )}

      {hov !== null && tipVal !== null && (
        <g transform={`translate(${tipX.toFixed(1)},${tipY.toFixed(1)})`}>
          <rect
            x="-30"
            y="-11"
            width="60"
            height="22"
            rx="2"
            fill="hsl(var(--popover))"
            stroke="hsl(var(--border))"
            strokeWidth="0.5"
            style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}
          />
          <text
            textAnchor="middle"
            y="1"
            fontSize="8.5"
            fontWeight="600"
            fill="hsl(var(--popover-foreground))"
          >
            {t('node_battery_voltage_percent', {
              voltage: (tipVal / 1000).toFixed(2),
              percent: mvToPercent(tipVal),
            })}
          </text>
          <text textAnchor="middle" fontSize="6.5" fill="hsl(var(--muted-foreground))" dy="-12">
            {t('node_tooltip_time_suffix', {
              label: t('node_tooltip_battery'),
              time: fmtTime(timestamps[hov], windowSeconds),
            })}
          </text>
        </g>
      )}
      <line
        x1={PAD_L}
        x2={CW}
        y1={INNER_H}
        y2={INNER_H}
        stroke="hsl(var(--border))"
        strokeWidth="0.5"
      />
      {showIdx.map((i) => (
        <text
          key={i}
          x={xPos(i).toFixed(1)}
          y={CH - 2}
          textAnchor={i === 0 ? 'start' : i === samples.length - 1 ? 'end' : 'middle'}
          fontSize="7"
          fill="hsl(var(--muted-foreground))"
        >
          {fmtTime(timestamps[i], windowSeconds)}
        </text>
      ))}
      {samples.map((_, i) => (
        <rect
          key={i}
          x={(PAD_L + i * hovZoneW).toFixed(1)}
          y="0"
          width={hovZoneW.toFixed(1)}
          height={`${INNER_H}`}
          fill="transparent"
          onMouseEnter={() => setHov(i)}
          onMouseLeave={() => setHov(null)}
        />
      ))}
    </svg>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

function ChartCard({
  title,
  stat,
  children,
}: {
  title: string;
  stat?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-baseline justify-between px-2.5 pt-2 pb-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </span>
        {stat && <span className="text-[10px] tabular-nums text-foreground">{stat}</span>}
      </div>
      <div className="px-1 pb-1.5">{children}</div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold text-foreground">{children}</h3>;
}

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-1 last:border-0">
      <span className="flex-shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={`break-all text-right text-xs text-foreground ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

/** Horizontal bar breakdown — used for route mix, hop profile, signal dist */
function HBarSection({
  title,
  items,
  colorFn,
}: {
  title: string;
  items: { label: string; count: number; share: number }[];
  colorFn?: (label: string) => string;
}) {
  const nonZero = items.filter((i) => i.count > 0);
  if (nonZero.length === 0) return null;
  const max = Math.max(...nonZero.map((i) => i.count), 1);

  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="space-y-1.5">
        {nonZero.map((item) => (
          <div key={item.label}>
            <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-foreground">{item.label}</span>
              <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                {item.count.toLocaleString()} · {fmtPct(item.share)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(item.count / max) * 100}%`,
                  background: colorFn ? colorFn(item.label) : 'hsl(var(--primary))',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export default function MyNodeView({ contacts }: Props) {
  const t = useT();
  const rawPackets = useRawPackets();
  const rawPacketStatsSession = useRawPacketStatsSession();
  const [config, setConfig] = useState<RadioConfig | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [stats, setStats] = useState<StatisticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedAt = useRef(0);

  // Time window
  const [selectedWindow, setSelectedWindow] = useState<TimeWindow>(DEFAULT_WINDOW);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  // Historical data
  const [historicalBins, setHistoricalBins] = useState<Bin[] | null>(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalError, setHistoricalError] = useState<string | null>(null);

  // Now ticker for stats snapshot
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(id);
  }, []);

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const cfgRes = await fetch('/api/radio/config');
      if (cfgRes.status === 503) {
        setError('radio-disconnected');
        return;
      }
      if (!cfgRes.ok) throw new Error('Could not load radio config');
      const [cfg, healthRes, statsRes] = await Promise.all([
        cfgRes.json() as Promise<RadioConfig>,
        fetch('/api/health'),
        fetch('/api/statistics'),
      ]);
      setConfig(cfg);
      if (healthRes.ok) setHealth(await healthRes.json());
      if (statsRes.ok) {
        const statsData: StatisticsResponse = await statsRes.json();
        setStats(statsData);
        setNoiseFloorSamples(statsData.noise_floor_24h.samples);
      }
      api.getBatteryHistory().then(
        (data) => setBatterySamples(data.samples),
        () => {}
      );
      loadedAt.current = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  // ── Historical fetch ──────────────────────────────────────────────────────
  const fetchHistorical = useCallback(async (startTs: number, endTs: number) => {
    setHistoricalLoading(true);
    setHistoricalError(null);
    try {
      const res = await fetch(
        `/api/packets/timeseries?start_ts=${startTs}&end_ts=${endTs}&bin_count=${BIN_COUNT}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setHistoricalBins(
        data.bins.map(
          (b: {
            start_ts: number;
            packet_count: number;
            byte_count: number;
            avg_rssi?: number | null;
            avg_snr?: number | null;
            type_counts?: Record<string, number>;
          }) => ({
            time: b.start_ts * 1000,
            packets: b.packet_count,
            bytes: b.byte_count,
            // Expand avg signal back into arrays so mean() works uniformly
            rssis: b.avg_rssi != null ? [b.avg_rssi] : [],
            snrs: b.avg_snr != null ? [b.avg_snr] : [],
            // type_counts from new endpoint, empty object for legacy data
            types: b.type_counts ?? {},
          })
        )
      );
    } catch (err) {
      setHistoricalError(err instanceof Error ? err.message : 'Failed to fetch history');
      setHistoricalBins(null);
    } finally {
      setHistoricalLoading(false);
    }
  }, []);
  // Trigger DB timeseries fetch for non-live windows; clear bins when switching back to live
  useEffect(() => {
    if (selectedWindow.useLive) {
      setHistoricalBins(null);
      return;
    }
    if (selectedWindow.key === 'custom') return; // custom uses the Apply button
    const endTs = nowSec;
    const startTs = selectedWindow.seconds !== null ? endTs - selectedWindow.seconds : 0;
    void fetchHistorical(startTs, endTs);
  }, [selectedWindow.key, selectedWindow.useLive, selectedWindow.seconds, nowSec, fetchHistorical]);

  const [historicalStats, setHistoricalStats] = useState<HistoricalStatsResponse | null>(null);
  const [historicalStatsLoading, setHistoricalStatsLoading] = useState(false);
  const [historicalStatsError, setHistoricalStatsError] = useState<string | null>(null);
  const [statsSource, setStatsSource] = useState<'session' | 'db'>('session');

  // Noise floor
  const [noiseFloorSamples, setNoiseFloorSamples] = useState<NoiseFloorSample[]>([]);
  const [noiseFloorSupported] = useState<boolean | null>(null);

  // Battery
  const [batterySamples, setBatterySamples] = useState<BatterySample[]>([]);

  // Fetch DB historical stats whenever the time window changes (uses nowSec which ticks every 30s)
  useEffect(() => {
    const windowDef = TIME_WINDOWS.find((w) => w.label === selectedWindow.label);
    if (!windowDef) return;

    const endTs = nowSec;
    const startTs = windowDef.seconds !== null ? endTs - windowDef.seconds : 0;

    setHistoricalStatsLoading(true);
    setHistoricalStatsError(null);

    fetch(`/api/packets/historical-stats?start_ts=${startTs}&end_ts=${endTs}`)
      .then((r) => r.json())
      .then((data: HistoricalStatsResponse) => {
        setHistoricalStats(data);
        setHistoricalStatsLoading(false);
      })
      .catch((err) => {
        setHistoricalStatsError(err instanceof Error ? err.message : 'Failed to load');
        setHistoricalStatsLoading(false);
      });
  }, [selectedWindow.label, nowSec]);

  // Battery: filter live samples for the selected window; fetch from DB for historical windows
  useEffect(() => {
    if (selectedWindow.useLive) {
      const cutoff = nowSec - (selectedWindow.seconds ?? 20 * 60);
      setBatterySamples((prev) => prev.filter((s) => s.timestamp >= cutoff));
      return;
    }
    if (selectedWindow.key === 'custom') return;
    const endTs = nowSec;
    const startTs = selectedWindow.seconds !== null ? endTs - selectedWindow.seconds : 0;
    api.getBatteryRange(startTs, endTs).then(
      (samples) => setBatterySamples(samples),
      () => {}
    );
  }, [selectedWindow.key, selectedWindow.useLive, selectedWindow.seconds, nowSec]);

  // Noise floor: filter live samples for live window; fetch from DB for historical windows
  useEffect(() => {
    if (noiseFloorSupported === false) return;
    if (selectedWindow.useLive) {
      // Filter in-memory stats samples to the live window (20m)
      const cutoff = nowSec - (selectedWindow.seconds ?? 20 * 60);
      setNoiseFloorSamples((prev) => prev.filter((s) => s.timestamp >= cutoff));
      return;
    }
    if (selectedWindow.key === 'custom') return; // handled by Apply button
    const endTs = nowSec;
    const startTs = selectedWindow.seconds !== null ? endTs - selectedWindow.seconds : 0;
    api.getNoiseFloorHistory(startTs, endTs).then(
      (samples) => setNoiseFloorSamples(samples),
      () => {} // silently ignore — chart will just show no data
    );
  }, [
    selectedWindow.key,
    selectedWindow.useLive,
    selectedWindow.seconds,
    nowSec,
    noiseFloorSupported,
  ]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const windowSeconds = useMemo((): number => {
    if (selectedWindow.key === 'custom' && customStart && customEnd)
      return Math.floor((new Date(customEnd).getTime() - new Date(customStart).getTime()) / 1000);
    return selectedWindow.seconds ?? 20 * 60;
  }, [selectedWindow, customStart, customEnd]);

  const liveBins = useMemo(
    () => buildLiveBins(rawPackets, windowSeconds * 1000),
    [rawPackets, windowSeconds]
  );
  const activeBins = selectedWindow.useLive ? liveBins : (historicalBins ?? liveBins);

  const liveStats = useMemo(() => {
    const totalPkts = activeBins.reduce((s, b) => s + b.packets, 0);
    const totalBytes = activeBins.reduce((s, b) => s + b.bytes, 0);
    return {
      packets: totalPkts,
      bytes: totalBytes,
      pktRate: (totalPkts / windowSeconds).toFixed(2),
      byteRate: (totalBytes / windowSeconds).toFixed(1),
      avgBytes: totalPkts > 0 ? (totalBytes / totalPkts).toFixed(1) : '0',
      windowLabel: fmtWindowLabel(selectedWindow.key, customStart, customEnd, t),
    };
  }, [activeBins, windowSeconds, selectedWindow.key, customStart, customEnd, t]);

  const typesInWindow = useMemo(
    () => [...new Set(activeBins.flatMap((b) => Object.keys(b.types)))],
    [activeBins]
  );

  // ── Session stats snapshot ────────────────────────────────────────────────
  const sessionSnapshot = useMemo(
    () => buildRawPacketStatsSnapshot(rawPacketStatsSession, 'session', nowSec),
    [rawPacketStatsSession, nowSec]
  );

  // Direct (0-hop) neighbours only: nodes heard with no relay in the path.
  // Flood / relayed observations (pathTokenCount > 0) are excluded so this
  // reflects genuine direct RF neighbours, not inferred last-hop relayers.
  const lastHopNeighborMap = useMemo(() => {
    const map = new Map<
      string,
      { label: string; count: number; bestRssi: number | null; lastSeen: number; type: number }
    >();
    for (const o of rawPacketStatsSession.observations) {
      if (o.pathTokenCount !== 0) continue; // skip flood/relayed arrivals
      if (!o.sourceKey) continue;
      const key = o.sourceKey;
      const contact = contacts.find((c) =>
        c.public_key.toLowerCase().startsWith(o.sourceKey!.toLowerCase().replace('hash1:', ''))
      );
      const label = contact
        ? getContactDisplayName(contact.name, contact.public_key, contact.last_advert)
        : (o.sourceLabel ?? o.sourceKey.slice(0, 12));
      const type = contact?.type ?? 0;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, { label, count: 1, bestRssi: o.rssi, lastSeen: o.timestamp, type });
      } else {
        existing.count++;
        existing.lastSeen = Math.max(existing.lastSeen, o.timestamp);
        if (o.rssi != null && (existing.bestRssi == null || o.rssi > existing.bestRssi))
          existing.bestRssi = o.rssi;
        existing.label = label;
        existing.type = type;
      }
    }
    return map;
  }, [rawPacketStatsSession.observations, contacts]);

  const resolvedMostActive = useMemo(
    () =>
      [...lastHopNeighborMap.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
        .slice(0, 5),
    [lastHopNeighborMap]
  );

  const resolvedStrongest = useMemo(
    () =>
      [...lastHopNeighborMap.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .filter((n) => n.bestRssi != null)
        .sort((a, b) => (b.bestRssi ?? -999) - (a.bestRssi ?? -999))
        .slice(0, 5),
    [lastHopNeighborMap]
  );

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    const disc = error === 'radio-disconnected';
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <svg
          className="h-10 w-10 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
          />
        </svg>
        <div>
          <p className="font-medium text-foreground">
            {disc ? t('settings_radio_not_connected') : error}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {disc ? t('node_error_connect_radio') : t('node_error_could_not_load')}
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
        >
          {t('node_retry')}
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 flex-shrink-0 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
            />
          </svg>
          <span className="text-sm font-semibold text-foreground">{t('node_page_title')}</span>
          {config && (
            <span className="text-sm text-muted-foreground">
              — {config.name || t('common_unnamed')}
            </span>
          )}
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          title={t('repeater_refresh')}
          className="rounded border border-border bg-card p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <svg
            className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {loading && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <Skeleton className="h-14 w-14 flex-shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
            <Skeleton className="h-10 w-full rounded-lg" />
            <div className="grid grid-cols-3 gap-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          </div>
        )}

        {!loading && config && (
          <>
            {/* ── Identity ── */}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-primary bg-background">
                  <svg
                    className="h-6 w-6 text-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
                    />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-base font-semibold text-foreground">
                      {config.name || t('node_unnamed_node')}
                    </h1>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-primary">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      {t('settings_radio_status_connected')}
                    </span>
                    <span className="inline-block rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t('node_this_device')}
                    </span>
                  </div>
                  <p className="mt-0.5 select-all break-all font-mono text-[10px] text-muted-foreground">
                    {config.public_key}
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    <span className="font-mono">
                      {t('node_radio_summary', {
                        freq: config.radio.freq,
                        sf: config.radio.sf,
                        bw: config.radio.bw,
                        cr: config.radio.cr,
                      })}
                    </span>
                    {health?.radio_device_info?.firmware_version && (
                      <span>
                        {t('node_firmware_prefix', {
                          version: health.radio_device_info.firmware_version,
                        })}
                      </span>
                    )}
                    {config.lat != null && config.lon != null && (
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${config.lat}&mlon=${config.lon}&zoom=13`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="transition hover:text-foreground"
                      >
                        {config.lat.toFixed(4)}, {config.lon.toFixed(4)} ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Live Activity charts ── */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="border-b border-border px-3 py-2 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    {t('node_live_activity_heading')}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    <span className="font-medium text-foreground">{liveStats.windowLabel}:</span>{' '}
                    {t('node_live_activity_summary', {
                      packets: liveStats.packets,
                      bytes: liveStats.bytes.toLocaleString(),
                      pktRate: liveStats.pktRate,
                      byteRate: liveStats.byteRate,
                      avgBytes: liveStats.avgBytes,
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground sm:hidden">
                    {t('node_live_activity_summary_compact', {
                      packets: liveStats.packets,
                      bytes: liveStats.bytes.toLocaleString(),
                    })}
                  </span>
                  {historicalLoading && (
                    <span className="text-[10px] text-muted-foreground animate-pulse">
                      {t('node_loading')}
                    </span>
                  )}
                </div>
                {historicalError && !historicalBins && (
                  <p className="text-[10px] text-destructive">
                    {t('node_historical_load_error', { error: historicalError })}
                  </p>
                )}
                {/* Time window buttons */}
                <div className="flex flex-wrap items-center gap-1">
                  {TIME_WINDOWS.map((w) => (
                    <button
                      key={w.key}
                      onClick={() => {
                        setSelectedWindow(w);
                        if (w.key === 'custom') setShowCustomPicker(true);
                        else setShowCustomPicker(false);
                      }}
                      className={`rounded px-2 py-0.5 text-xs transition ${selectedWindow.key === w.key ? 'bg-primary text-primary-foreground font-medium' : 'border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                    >
                      {windowLabel(w.key, t)}
                    </button>
                  ))}
                </div>
                {showCustomPicker && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">{t('node_custom_from')}</span>
                    <input
                      type="datetime-local"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground"
                    />
                    <span className="text-xs text-muted-foreground">{t('node_custom_to')}</span>
                    <input
                      type="datetime-local"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground"
                    />
                    {customStart && customEnd && (
                      <button
                        onClick={() => {
                          const s = Math.floor(new Date(customStart).getTime() / 1000);
                          const e = Math.floor(new Date(customEnd).getTime() / 1000);
                          if (e > s) void fetchHistorical(s, e);
                        }}
                        className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-accent transition"
                      >
                        {t('node_apply')}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 p-2 md:grid-cols-3">
                <ChartCard
                  title={t('node_chart_bytes_received')}
                  stat={t('node_value_bytes_compact', { value: liveStats.bytes.toLocaleString() })}
                >
                  <BarChart
                    bins={activeBins}
                    valueKey="bytes"
                    color="hsl(var(--primary))"
                    formatY={(v) =>
                      v >= 1000
                        ? t('node_value_k_compact', { value: (v / 1000).toFixed(0) })
                        : String(v)
                    }
                    id="grad-bytes"
                    tooltipLabel={t('node_tooltip_bytes')}
                    windowSeconds={windowSeconds}
                  />
                </ChartCard>
                <ChartCard
                  title={t('settings_radio_stat_packets_received')}
                  stat={String(liveStats.packets)}
                >
                  <BarChart
                    bins={activeBins}
                    valueKey="packets"
                    color="hsl(var(--info))"
                    id="grad-pkts"
                    tooltipLabel={t('node_tooltip_packets')}
                    windowSeconds={windowSeconds}
                  />
                </ChartCard>
                <ChartCard title={t('node_chart_packets_by_type')}>
                  <StackedBarChart bins={activeBins} windowSeconds={windowSeconds} t={t} />
                  {typesInWindow.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-2 px-1">
                      {typesInWindow.map((pt) => (
                        <span
                          key={pt}
                          className="flex items-center gap-1 text-[9px] text-muted-foreground"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                            style={{ background: typeColor(pt) }}
                          />
                          {pt}
                        </span>
                      ))}
                    </div>
                  ) : !selectedWindow.useLive ? (
                    <p className="px-1 text-[9px] text-muted-foreground italic">
                      {t('node_type_breakdown_live_only')}
                    </p>
                  ) : null}
                </ChartCard>
                <ChartCard
                  title={t('node_chart_snr_title')}
                  stat={(() => {
                    const v = mean(activeBins.flatMap((b) => b.snrs));
                    return v != null ? t('node_stat_db_avg', { value: v.toFixed(1) }) : undefined;
                  })()}
                >
                  <LineChart
                    bins={activeBins}
                    valueKey="snr"
                    color="hsl(var(--warning))"
                    formatY={(v) => t('node_value_db_compact', { value: v })}
                    id="line-snr"
                    tooltipLabel={t('trace_snr_label')}
                    windowSeconds={windowSeconds}
                    t={t}
                  />
                </ChartCard>
                <ChartCard
                  title={t('node_chart_rssi_title')}
                  stat={(() => {
                    const v = mean(activeBins.flatMap((b) => b.rssis));
                    return v != null ? t('node_stat_dbm_avg', { value: v.toFixed(0) }) : undefined;
                  })()}
                >
                  <LineChart
                    bins={activeBins}
                    valueKey="rssi"
                    color="hsl(var(--destructive))"
                    formatY={(v) => t('node_value_dbm_compact', { value: v })}
                    id="line-rssi"
                    tooltipLabel={t('node_tooltip_rssi')}
                    windowSeconds={windowSeconds}
                    t={t}
                  />
                </ChartCard>
                {noiseFloorSupported !== false && (
                  <ChartCard
                    title={t('settings_radio_stat_noise_floor')}
                    stat={
                      noiseFloorSamples.length > 0
                        ? t('node_value_dbm', {
                            value: noiseFloorSamples[noiseFloorSamples.length - 1].noise_floor_dbm,
                          })
                        : undefined
                    }
                  >
                    <NoiseFloorLineChart
                      samples={noiseFloorSamples}
                      windowSeconds={windowSeconds}
                      t={t}
                    />
                  </ChartCard>
                )}
                {batterySamples.length > 0 && (
                  <ChartCard
                    title={t('settings_radio_stat_battery')}
                    stat={
                      batterySamples.length > 0
                        ? (() => {
                            const mv = batterySamples[batterySamples.length - 1].battery_mv;
                            return t('node_battery_voltage_percent', {
                              voltage: (mv / 1000).toFixed(2),
                              percent: mvToPercent(mv),
                            });
                          })()
                        : undefined
                    }
                  >
                    <BatteryLineChart
                      samples={batterySamples}
                      windowSeconds={windowSeconds}
                      t={t}
                    />
                  </ChartCard>
                )}
              </div>

              {!selectedWindow.useLive && (
                <p className="px-3 pb-2 text-[10px] text-muted-foreground">
                  {' '}
                  {t('node_historical_data_note')}{' '}
                  {!selectedWindow.useLive && t('node_historical_signal_note')}
                </p>
              )}
            </div>

            {/* ── Stats (merged session + DB) ── */}
            {(sessionSnapshot.packetCount > 0 ||
              historicalStats ||
              historicalStatsLoading ||
              historicalStatsError) && (
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="border-b border-border px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {t('node_stats_heading')}
                    </span>
                    {statsSource === 'db' && historicalStatsLoading && (
                      <span className="text-[10px] text-muted-foreground animate-pulse">
                        {t('node_loading')}
                      </span>
                    )}
                    {statsSource === 'db' && historicalStatsError && (
                      <span className="text-[10px] text-destructive">{historicalStatsError}</span>
                    )}
                  </div>
                  <div className="flex rounded border border-border overflow-hidden text-xs">
                    <button
                      onClick={() => setStatsSource('session')}
                      className={cn(
                        'px-2.5 py-1 font-medium transition-colors',
                        statsSource === 'session'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background text-muted-foreground hover:bg-accent/50'
                      )}
                    >
                      {t('packet_window_session')}
                    </button>
                    <button
                      onClick={() => setStatsSource('db')}
                      disabled={!historicalStats && !historicalStatsLoading}
                      className={cn(
                        'px-2.5 py-1 font-medium transition-colors border-l border-border',
                        statsSource === 'db'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background text-muted-foreground hover:bg-accent/50',
                        !historicalStats &&
                          !historicalStatsLoading &&
                          'opacity-40 cursor-not-allowed'
                      )}
                    >
                      {t('node_stats_db_tab', { window: liveStats.windowLabel })}
                    </button>
                  </div>
                </div>

                {/* Session view */}
                {statsSource === 'session' &&
                  (sessionSnapshot.packetCount > 0 ? (
                    <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
                      <StatTile
                        label={t('packet_stat_packets_per_min')}
                        value={sessionSnapshot.packetsPerMinute.toFixed(1)}
                        sub={t('node_total_suffix', {
                          count: sessionSnapshot.packetCount.toLocaleString(),
                        })}
                      />
                      <StatTile
                        label={t('packet_stat_decrypt_rate')}
                        value={fmtPct(sessionSnapshot.decryptRate)}
                        sub={`${sessionSnapshot.decryptedCount.toLocaleString()} / ${sessionSnapshot.packetCount.toLocaleString()}`}
                      />
                      <StatTile
                        label={t('packet_stat_unique_sources')}
                        value={sessionSnapshot.uniqueSources}
                        sub={t('node_distinct_senders')}
                      />
                      <StatTile
                        label={t('node_distinct_paths')}
                        value={sessionSnapshot.distinctPaths}
                        sub={t('node_path_bearing_pct', {
                          percent: fmtPct(sessionSnapshot.pathBearingRate),
                        })}
                      />
                      <StatTile
                        label={t('node_best_rssi')}
                        value={fmtRssi(sessionSnapshot.bestRssi, t)}
                      />
                      <StatTile
                        label={t('packet_stat_median_rssi')}
                        value={fmtRssi(sessionSnapshot.medianRssi, t)}
                        sub={
                          sessionSnapshot.averageRssi != null
                            ? t('node_avg_prefix', {
                                value: fmtRssi(sessionSnapshot.averageRssi, t),
                              })
                            : undefined
                        }
                      />
                    </div>
                  ) : (
                    <p className="p-4 text-center text-xs italic text-muted-foreground">
                      {t('node_no_session_data')}
                    </p>
                  ))}

                {/* DB view */}
                {statsSource === 'db' && historicalStats && (
                  <div className="p-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      <StatTile
                        label={t('repeater_packets_label')}
                        value={historicalStats.total_packets.toLocaleString()}
                        sub={t('node_per_min_suffix', {
                          value: historicalStats.packets_per_minute.toFixed(2),
                        })}
                      />
                      <StatTile
                        label={t('node_bytes_label')}
                        value={fmtBytes(historicalStats.total_bytes, t)}
                        sub={t('node_value_bytes_compact', {
                          value: historicalStats.total_bytes.toLocaleString(),
                        })}
                      />
                      <StatTile
                        label={t('node_best_rssi')}
                        value={fmtRssi(historicalStats.best_rssi, t)}
                        sub={
                          historicalStats.avg_rssi != null
                            ? t('node_avg_prefix', { value: fmtRssi(historicalStats.avg_rssi, t) })
                            : undefined
                        }
                      />
                      {/* Session-only fields not tracked by DB — borrow from live session */}
                      {sessionSnapshot.packetCount > 0 && (
                        <>
                          <StatTile
                            label={t('packet_stat_decrypt_rate')}
                            value={fmtPct(sessionSnapshot.decryptRate)}
                            sub={t('node_this_session')}
                          />
                          <StatTile
                            label="Unique Sources"
                            value={sessionSnapshot.uniqueSources}
                            sub="this session"
                          />
                          <StatTile
                            label="Distinct Paths"
                            value={sessionSnapshot.distinctPaths}
                            sub="this session"
                          />
                        </>
                      )}
                    </div>

                    {historicalStats.has_type_data && (
                      <HBarSection
                        title={t('packet_types_title')}
                        items={Object.entries(historicalStats.type_counts)
                          .sort((a, b) => b[1] - a[1])
                          .map(([label, count]) => ({
                            label,
                            count,
                            share:
                              historicalStats.total_packets > 0
                                ? count / historicalStats.total_packets
                                : 0,
                          }))}
                        colorFn={typeColor}
                      />
                    )}

                    {historicalStats.busiest_channels &&
                      historicalStats.busiest_channels.length > 0 && (
                        <div>
                          <SectionTitle>{t('node_busiest_channels')}</SectionTitle>
                          <div className="space-y-1">
                            {historicalStats.busiest_channels.map((ch) => {
                              const maxCount = historicalStats.busiest_channels![0].message_count;
                              const pct = maxCount > 0 ? (ch.message_count / maxCount) * 100 : 0;
                              return (
                                <div key={ch.channel_key} className="flex items-center gap-2">
                                  <span className="w-28 flex-shrink-0 truncate text-xs text-foreground">
                                    {ch.channel_name ?? ch.channel_key.slice(0, 10)}
                                  </span>
                                  <div className="flex-1 overflow-hidden rounded-full bg-muted h-1.5">
                                    <div
                                      className="h-full rounded-full bg-primary transition-all"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="w-14 flex-shrink-0 text-right tabular-nums text-[10px] text-muted-foreground">
                                    {t('common_msg_count', {
                                      count: ch.message_count,
                                      n: ch.message_count.toLocaleString(),
                                    })}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                  </div>
                )}

                {statsSource === 'db' && !historicalStats && historicalStatsLoading && (
                  <p className="p-4 text-center text-xs text-muted-foreground animate-pulse">
                    {t('node_loading_db_stats')}
                  </p>
                )}
                {statsSource === 'db' &&
                  !historicalStats &&
                  !historicalStatsLoading &&
                  !historicalStatsError && (
                    <p className="p-4 text-center text-xs italic text-muted-foreground">
                      {t('node_no_db_stats')}
                    </p>
                  )}
              </div>
            )}

            {/* ── Session breakdowns (from rawPacketStats) ── */}
            {sessionSnapshot.packetCount > 0 && (
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="border-b border-border px-3 py-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {t('node_session_breakdown_heading')}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t('node_session_packets_suffix', {
                      count: sessionSnapshot.packetCount.toLocaleString(),
                      time: relTime(Math.floor(rawPacketStatsSession.sessionStartedAt / 1000), t),
                    })}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 p-3 md:grid-cols-2">
                  <HBarSection
                    title={t('packet_types_title')}
                    items={sessionSnapshot.payloadBreakdown}
                    colorFn={typeColor}
                  />
                  <HBarSection
                    title={t('packet_route_mix_title')}
                    items={sessionSnapshot.routeBreakdown}
                    colorFn={(label) => {
                      if (label.includes('Flood')) return 'hsl(var(--primary))';
                      if (label.includes('Direct')) return 'hsl(var(--success))';
                      if (label.includes('Transport')) return 'hsl(var(--info))';
                      return 'hsl(var(--muted-foreground))';
                    }}
                  />
                  <HBarSection
                    title={t('packet_hop_profile_title')}
                    items={sessionSnapshot.hopProfile}
                    colorFn={(label) => {
                      if (label === '0') return 'hsl(var(--success))';
                      if (label === '1') return 'hsl(var(--primary))';
                      if (label === '2-5') return 'hsl(var(--info))';
                      if (label === '6-10') return 'hsl(var(--warning))';
                      return 'hsl(var(--destructive))';
                    }}
                  />
                  <HBarSection
                    title={t('packet_signal_distribution_title')}
                    items={sessionSnapshot.rssiBuckets}
                    colorFn={(label) => {
                      if (label.includes('Strong')) return 'hsl(var(--success))';
                      if (label.includes('Okay')) return 'hsl(var(--warning))';
                      return 'hsl(var(--destructive))';
                    }}
                  />
                  <HBarSection
                    title={t('packet_hop_byte_width_title')}
                    items={sessionSnapshot.hopByteWidthProfile}
                    colorFn={(label) => {
                      if (label.includes('1 byte')) return 'hsl(var(--primary))';
                      if (label.includes('2 bytes')) return 'hsl(var(--info))';
                      if (label.includes('3 bytes')) return 'hsl(var(--success))';
                      return 'hsl(var(--muted-foreground))';
                    }}
                  />
                </div>
              </div>
            )}

            {/* ── Neighbors ── */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Most active */}
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="border-b border-border px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {t('node_neighbors_most_active')}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {selectedWindow.useLive ? t('node_live_session_label') : liveStats.windowLabel}
                  </span>
                </div>
                <div className="p-3">
                  {selectedWindow.useLive ? (
                    <>
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        {t('node_direct_neighbors_count_desc')}
                      </p>
                      {resolvedMostActive.length === 0 ? (
                        <p className="py-3 text-center text-xs italic text-muted-foreground">
                          {t('node_no_direct_neighbors')}
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {resolvedMostActive.map((n) => (
                            <div
                              key={n.key}
                              className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-foreground">
                                  {n.label}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {t('node_neighbor_packets_type_suffix', {
                                    count: n.count.toLocaleString(),
                                    type: nodeTypeLabel(n.type, t),
                                  })}
                                </div>
                              </div>
                              <span className="flex-shrink-0 text-xs text-muted-foreground">
                                {fmtRssi(n.bestRssi, t)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        {t('node_advert_count_desc')}
                      </p>
                      {!historicalStats || historicalStats.neighbors_by_count.length === 0 ? (
                        <p className="py-3 text-center text-xs italic text-muted-foreground">
                          {historicalStatsLoading
                            ? t('node_loading')
                            : t('node_no_neighbor_data_window')}
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {historicalStats.neighbors_by_count.slice(0, 10).map((n) => {
                            const displayName = n.name || n.public_key.slice(0, 12);
                            const nType = contacts.find((c) => c.public_key === n.public_key)?.type;
                            return (
                              <div
                                key={n.public_key}
                                className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium text-foreground">
                                    {displayName}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {t('node_neighbor_adverts_type_suffix', {
                                      count: n.heard_count.toLocaleString(),
                                      type: nodeTypeLabel(nType, t),
                                    })}
                                  </div>
                                </div>
                                <span className="flex-shrink-0 text-xs text-muted-foreground">
                                  {fmtRssi(n.best_rssi ?? null, t)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Strongest signal */}
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="border-b border-border px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {t('node_neighbors_strongest_signal')}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {selectedWindow.useLive ? t('node_live_session_label') : liveStats.windowLabel}
                  </span>
                </div>
                <div className="p-3">
                  {selectedWindow.useLive ? (
                    <>
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        {t('node_direct_neighbors_rssi_desc')}
                      </p>
                      {resolvedStrongest.length === 0 ? (
                        <p className="py-3 text-center text-xs italic text-muted-foreground">
                          {t('node_no_direct_neighbors_rssi')}
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {resolvedStrongest.map((n) => (
                            <div
                              key={n.key}
                              className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-foreground">
                                  {n.label}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {t('node_neighbor_relseen_type_suffix', {
                                    time: relTime(n.lastSeen, t),
                                    type: nodeTypeLabel(n.type, t),
                                  })}
                                </div>
                              </div>
                              <span className="flex-shrink-0 text-xs font-medium text-foreground">
                                {fmtRssi(n.bestRssi, t)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mb-2 text-[11px] text-muted-foreground">
                        {t('node_strongest_advert_desc')}
                      </p>
                      {!historicalStats || historicalStats.neighbors_by_signal.length === 0 ? (
                        <p className="py-3 text-center text-xs italic text-muted-foreground">
                          {historicalStatsLoading
                            ? t('node_loading')
                            : t('node_no_signal_data_window')}
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {historicalStats.neighbors_by_signal.slice(0, 10).map((n) => {
                            const displayName = n.name || n.public_key.slice(0, 12);
                            const nType = contacts.find((c) => c.public_key === n.public_key)?.type;
                            return (
                              <div
                                key={n.public_key}
                                className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium text-foreground">
                                    {displayName}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {t('node_neighbor_relseen_type_suffix', {
                                      time: relTime(n.last_seen, t),
                                      type: nodeTypeLabel(nType, t),
                                    })}
                                  </div>
                                </div>
                                <span className="flex-shrink-0 text-xs font-medium text-foreground">
                                  {fmtRssi(n.best_rssi ?? null, t)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ── Details ── */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="border-b border-border px-3 py-2">
                <span className="text-sm font-semibold text-foreground">
                  {t('node_details_heading')}
                </span>
              </div>
              <div className="p-3">
                <KV label={t('node_detail_id')} value={config.public_key} mono />
                <KV
                  label={t('node_detail_frequency')}
                  value={t('node_value_mhz', { value: config.radio.freq })}
                />
                <KV
                  label={t('node_detail_bandwidth')}
                  value={t('node_value_khz', { value: config.radio.bw })}
                />
                <KV
                  label={t('settings_radio_spreading_factor_label')}
                  value={t('node_value_sf', { value: config.radio.sf })}
                />
                <KV
                  label={t('settings_radio_coding_rate_label')}
                  value={t('node_value_cr', { value: config.radio.cr })}
                />
                <KV
                  label={t('repeater_tx_power_label')}
                  value={t('node_tx_power_value', {
                    power: config.tx_power,
                    max: config.max_tx_power,
                  })}
                />
                <KV
                  label={t('settings_radio_path_hash_mode_label')}
                  value={
                    config.path_hash_mode === 0
                      ? t('settings_statistics_path_hash_1byte')
                      : config.path_hash_mode === 1
                        ? t('settings_statistics_path_hash_2byte')
                        : t('settings_statistics_path_hash_3byte')
                  }
                />
                {config.lat != null && config.lon != null && (
                  <KV
                    label={t('contact_location')}
                    value={`${config.lat.toFixed(5)}, ${config.lon.toFixed(5)}`}
                  />
                )}
                {health?.radio_device_info?.model && (
                  <KV label={t('node_detail_model')} value={health.radio_device_info.model} />
                )}
                {health?.radio_device_info?.firmware_version && (
                  <KV
                    label={t('repeater_firmware_label')}
                    value={health.radio_device_info.firmware_version}
                    mono
                  />
                )}
                {health?.connection_info && (
                  <KV
                    label={t('settings_radio_connection_heading')}
                    value={health.connection_info}
                    mono
                  />
                )}
              </div>
            </div>

            {stats && (
              <>
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="border-b border-border px-3 py-2">
                    <span className="text-sm font-semibold text-foreground">
                      {t('node_network_totals_heading')}
                    </span>
                  </div>
                  <div className="p-3">
                    <KV
                      label={t('node_total_packets_label')}
                      value={stats.total_packets.toLocaleString()}
                    />
                    <KV
                      label={t('settings_statistics_decrypted_label')}
                      value={t('node_count_percent', {
                        count: stats.decrypted_packets.toLocaleString(),
                        percent:
                          stats.total_packets > 0
                            ? Math.round((stats.decrypted_packets / stats.total_packets) * 100)
                            : 0,
                      })}
                    />
                    <KV
                      label={t('settings_statistics_undecrypted_label')}
                      value={stats.undecrypted_packets.toLocaleString()}
                    />
                    <KV
                      label={t('contact_direct_messages')}
                      value={stats.total_dms.toLocaleString()}
                    />
                    <KV
                      label={t('contact_channel_messages')}
                      value={stats.total_channel_messages.toLocaleString()}
                    />
                    <KV
                      label={t('repeater_series_sent')}
                      value={stats.total_outgoing.toLocaleString()}
                    />
                    <KV
                      label={t('settings_statistics_contacts_label')}
                      value={stats.contact_count}
                    />
                    <KV
                      label={t('settings_statistics_repeaters_label')}
                      value={stats.repeater_count}
                    />
                    <KV
                      label={t('settings_statistics_channels_label')}
                      value={stats.channel_count}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="border-b border-border px-3 py-2">
                    <span className="text-sm font-semibold text-foreground">
                      {t('node_nodes_heard_heading')}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 p-3">
                    {[
                      {
                        label: t('channel_last_hour'),
                        c: stats.contacts_heard.last_hour,
                        r: stats.repeaters_heard.last_hour,
                      },
                      {
                        label: t('common_last_24h'),
                        c: stats.contacts_heard.last_24_hours,
                        r: stats.repeaters_heard.last_24_hours,
                      },
                      {
                        label: t('channel_last_7d'),
                        c: stats.contacts_heard.last_week,
                        r: stats.repeaters_heard.last_week,
                      },
                    ].map(({ label, c, r }) => (
                      <div
                        key={label}
                        className="rounded border border-border bg-background p-2 text-center"
                      >
                        <div className="mb-1 text-[10px] text-muted-foreground">{label}</div>
                        <div className="text-lg font-semibold tabular-nums text-foreground">
                          {c + r}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {t('bulkdelete_summary_repeaters', { count: r })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {stats.busiest_channels_24h.length > 0 && (
                  <div className="rounded-lg border border-border bg-card overflow-hidden">
                    <div className="border-b border-border px-3 py-2">
                      <span className="text-sm font-semibold text-foreground">
                        {t('node_busiest_channels_24h')}
                      </span>
                    </div>
                    <div className="p-3 space-y-1">
                      {stats.busiest_channels_24h.map((ch) => {
                        const maxCount = stats.busiest_channels_24h[0].message_count;
                        const pct = maxCount > 0 ? (ch.message_count / maxCount) * 100 : 0;
                        return (
                          <div key={ch.channel_key} className="flex items-center gap-2">
                            <span className="w-28 flex-shrink-0 truncate text-xs text-foreground">
                              {ch.channel_name}
                            </span>
                            <div className="flex-1 overflow-hidden rounded-full bg-muted h-1.5">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-14 flex-shrink-0 text-right tabular-nums text-[10px] text-muted-foreground">
                              {t('common_msg_count', {
                                count: ch.message_count,
                                n: ch.message_count.toLocaleString(),
                              })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {(stats.path_hash_width_24h?.total_packets ?? 0) > 0 && (
                  <div className="rounded-lg border border-border bg-card overflow-hidden">
                    <div className="border-b border-border px-3 py-2">
                      <span className="text-sm font-semibold text-foreground">
                        {t('node_path_hash_width_24h_heading')}
                      </span>
                    </div>
                    <div className="p-3">
                      <KV
                        label={t('path_discovery_hop_width_1byte')}
                        value={t('node_hop_pct_pkts', {
                          percent: stats.path_hash_width_24h!.single_byte_pct.toFixed(1),
                          count: stats.path_hash_width_24h!.single_byte.toLocaleString(),
                        })}
                      />
                      <KV
                        label={t('path_discovery_hop_width_2byte')}
                        value={t('node_hop_pct_pkts', {
                          percent: stats.path_hash_width_24h!.double_byte_pct.toFixed(1),
                          count: stats.path_hash_width_24h!.double_byte.toLocaleString(),
                        })}
                      />
                      <KV
                        label={t('path_discovery_hop_width_3byte')}
                        value={t('node_hop_pct_pkts', {
                          percent: stats.path_hash_width_24h!.triple_byte_pct.toFixed(1),
                          count: stats.path_hash_width_24h!.triple_byte.toLocaleString(),
                        })}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            <p className="pb-2 text-center text-[10px] text-muted-foreground">
              {t('node_refreshed_suffix', {
                time: relTime(Math.floor(loadedAt.current / 1000), t),
              })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
