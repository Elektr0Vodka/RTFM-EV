import { describe, expect, it } from 'vitest';

import type { Tone } from '../utils/accessibility';
import { contrastRatio, deltaE2000, hexToHslTriplet, simulateCvd } from '../utils/cvd/colorMath';
import {
  getDataColors,
  getSemanticColors,
  MIN_SIMULATED_DE2000,
  type DataColors,
  type SemanticColors,
} from '../utils/cvd/palettes';
import { NODE_RECENCY_COLORS, NODE_TYPE_STROKE } from '../map/layers/nodesLayer';
import { HOP_COLORS, RECEIVER_COLOR, SENDER_COLOR } from '../map/routeMapVisuals';
import { FOLLOW_OS_THEME_ID, THEMES } from '../utils/theme';

const MODES = ['protan', 'deutan', 'tritan'] as const;
const TONES: Tone[] = ['dark', 'light'];

/** Basemap reference colours for the map contrast rule (my call; adjustable). */
const BASEMAP_REF: Record<Tone, string> = { light: '#f2efe9', dark: '#1b1b1d' };

function pairs<T>(xs: T[]): Array<[T, T]> {
  const out: Array<[T, T]> = [];
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++) out.push([xs[i], xs[j]]);
  return out;
}

function adjacent<T>(xs: T[]): Array<[T, T]> {
  return xs.slice(1).map((x, i) => [xs[i], x] as [T, T]);
}

function mustDiffer(s: SemanticColors, d: DataColors): Array<[string, string, string]> {
  const tag = (name: string, ps: Array<[string, string]>) =>
    ps.map(([a, b]) => [name, a, b] as [string, string, string]);
  return [
    ...tag('semantic', pairs([s.success, s.warning, s.destructive])),
    ...tag('status', [[s.statusConnected, s.statusDisconnected]]),
    ...tag('signal', pairs([d.signal.bad, d.signal.mid, d.signal.good])),
    ...tag(
      'recency',
      adjacent([d.recency.recent, d.recency.today, d.recency.stale, d.recency.old])
    ),
    ...tag('roles', pairs(Object.values(d.roles))),
    ...tag('series', pairs(d.series)),
    // Hop markers share a map with each other and with S and R, so every pair counts.
    ...tag('hops', pairs(d.hops)),
    ...tag('endpoints', pairs([d.sender, d.receiver])),
    ...tag(
      'endpoint-vs-hop',
      d.hops.flatMap(
        (h) =>
          [
            [d.sender, h],
            [d.receiver, h],
          ] as Array<[string, string]>
      )
    ),
  ];
}

function themeCards(): Array<{ id: string; card: string; tone: Tone }> {
  return THEMES.filter((t) => t.id !== FOLLOW_OS_THEME_ID).map((t) => {
    const lightness = parseFloat(hexToHslTriplet(t.swatches[1]).split(' ')[2]);
    return { id: t.id, card: t.swatches[1], tone: lightness < 50 ? 'dark' : 'light' };
  });
}

describe('cvd palettes', () => {
  it.each(TONES)('keeps the theme tokens when off (%s)', (tone) => {
    expect(getSemanticColors('off', tone)).toBeNull();
  });

  it.each(TONES)('returns today’s data colours when off (%s)', (tone) => {
    expect(getDataColors('off', tone)).toEqual({
      signal: { bad: '#f59e0b', mid: '#3b82f6', good: '#22c55e' },
      recency: NODE_RECENCY_COLORS,
      roles: NODE_TYPE_STROKE,
      hops: HOP_COLORS,
      sender: SENDER_COLOR,
      receiver: RECEIVER_COLOR,
      series: ['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'],
    });
  });

  it('has a distinguishability floor of at least 10', () => {
    expect(MIN_SIMULATED_DE2000).toBeGreaterThanOrEqual(10);
  });

  for (const mode of MODES) {
    for (const tone of TONES) {
      it(`keeps colours that must differ apart under ${mode} vision (${tone})`, () => {
        const s = getSemanticColors(mode, tone)!;
        const d = getDataColors(mode, tone);
        const failures = mustDiffer(s, d)
          .map(([group, a, b]) => ({
            group,
            a,
            b,
            de: deltaE2000(simulateCvd(a, mode), simulateCvd(b, mode)),
          }))
          .filter((r) => r.de < MIN_SIMULATED_DE2000)
          .map((r) => `${r.group} ${r.a}/${r.b}: ${r.de.toFixed(1)}`);
        expect(failures).toEqual([]);
      });

      it(`keeps map colours readable on a ${tone} basemap under ${mode}`, () => {
        const d = getDataColors(mode, tone);
        const all = [
          ...Object.values(d.signal),
          ...Object.values(d.recency),
          ...Object.values(d.roles),
          ...d.hops,
          d.sender,
          d.receiver,
          ...d.series,
        ];
        const failures = all
          .filter((c) => contrastRatio(c, BASEMAP_REF[tone]) < 3)
          .map((c) => `${c}: ${contrastRatio(c, BASEMAP_REF[tone]).toFixed(2)}`);
        expect(failures).toEqual([]);
      });
    }

    it(`keeps status colours readable on every theme's cards under ${mode}`, () => {
      const failures: string[] = [];
      for (const { id, card, tone } of themeCards()) {
        const s = getSemanticColors(mode, tone)!;
        const graphic = [
          s.success,
          s.warning,
          s.destructive,
          s.info,
          s.statusConnected,
          s.statusDisconnected,
        ];
        for (const c of graphic) {
          if (contrastRatio(c, card) < 3) failures.push(`${id} ${c} graphic`);
        }
        for (const c of [s.success, s.warning, s.destructive]) {
          if (contrastRatio(c, card) < 4.5) failures.push(`${id} ${c} text`);
        }
        const fg: Array<[string, string]> = [
          [s.success, s.successFg],
          [s.warning, s.warningFg],
          [s.destructive, s.destructiveFg],
          [s.info, s.infoFg],
        ];
        for (const [base, f] of fg) {
          if (contrastRatio(base, f) < 4.5) failures.push(`${id} ${base}/${f} foreground`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
