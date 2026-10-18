import { useCallback } from 'react';
import { api } from '../../api';
import { COMPANION_FILTER_KEYS, FILTER_DROP_KEYS } from '../../components/snmp/snmpFields';
import { useCvdMode } from '../../hooks/useCvdColors';
import { useLocale, useT, type TFn } from '../../i18n';
import type {
  CompanionFilterCounterKey,
  CompanionFilterHistory,
  HostRepeaterStats,
  SnmpHistoryEntry,
} from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import type { FilterStatsReport } from '../../utils/filterStatsReport';
import { formatNumber } from '../../utils/localeFormat';
import type { CardFigure, CardText } from '../cardChrome';
import { shareFilename } from '../filename';
import { loadShareBrand } from '../shareBrand';
import type { ShareBuildOptions, ShareCardResult } from '../ShareCardDialog';
import {
  buildFilterResult,
  snmpCounterBins,
  snmpCounterTotals,
  type FilterResultModel,
} from './filterResult';
import { renderFilterCard } from './filterResultRender';

type Build = (opts: ShareBuildOptions) => Promise<ShareCardResult>;

const SNMP_BINS = 24;

/** "14 min", "38 s", "2.5 h": airtime saved, rounded for a card. */
export function formatAirtime(ms: number, t: TFn): string {
  const s = ms / 1000;
  if (s < 60) return t('share_duration_s', { n: Math.round(s) });
  const min = s / 60;
  if (min < 60) return t('share_duration_min', { n: min < 10 ? min.toFixed(1) : Math.round(min) });
  const h = min / 60;
  return t('share_duration_h', { n: h < 10 ? h.toFixed(1) : Math.round(h) });
}

/** The parts every filter card shares: figures that always lead, brand, file. */
function useFilterCard(kind: string) {
  const t = useT();
  const { locale } = useLocale();
  const cvd = useCvdMode();
  const fmt = useCallback((n: number) => formatNumber(locale, n), [locale]);
  const make = useCallback(
    async (
      model: FilterResultModel,
      text: CardText,
      heroLabel: string,
      alt: string
    ): Promise<ShareCardResult> => {
      const brand = await loadShareBrand();
      const { png, gif } = await renderFilterCard(
        model,
        text,
        brand,
        { heroLabel, tone: 'dark', cvd },
        fmt
      );
      return {
        png,
        gif,
        filenameBase: shareFilename(kind, new Date()),
        alt,
        shareTitle: text.title,
      };
    },
    [kind, cvd, fmt]
  );
  // The top reason as its share of the total, named in the label: a reason
  // name is too long for the big figure value.
  const topReason = (model: FilterResultModel): CardFigure | null => {
    const top = model.reasons[0];
    if (!top || model.total <= 0) return null;
    return {
      value: t('share_fig_percent', { n: Math.round((top.value / model.total) * 100) }),
      label: top.label,
    };
  };
  return { t, fmt, make, topReason };
}

/** 5a (repeater, SNMP `.7`) and 5b for another companion (SNMP `.10`). */
export function useSnmpFilterBuild(args: {
  name: string;
  history: SnmpHistoryEntry[];
  group: 'filter' | 'companion_filter';
  windowLabel: string;
}): Build | null {
  const { t, fmt, make, topReason } = useFilterCard(args.group === 'filter' ? 'filter' : 'cfilter');
  const { name, history, group, windowLabel } = args;
  const build = useCallback(async () => {
    const keys = group === 'filter' ? FILTER_DROP_KEYS : COMPANION_FILTER_KEYS;
    const totals = snmpCounterTotals(history, keys);
    const model = buildFilterResult(
      keys.map((k) => ({ key: k, label: t(`snmp_field_${k}`), value: totals[k] })),
      { bins: snmpCounterBins(history, keys, SNMP_BINS) }
    );
    const repeater = group === 'filter';
    const airtime = repeater
      ? snmpCounterTotals(history, ['filter_air_saved_ms']).filter_air_saved_ms
      : null;
    const dryRun = repeater && history[history.length - 1]?.values.filter_dry_run === 1;
    // Dry run: nothing was dropped, so every label says "would have".
    const heroLabel = !repeater
      ? t('share_filter_hero_hidden')
      : dryRun
        ? t('share_filter_hero_would_drop')
        : t('share_filter_hero_dropped');
    const figures: CardFigure[] = [
      {
        value: fmt(model.total),
        label: heroLabel,
      },
    ];
    if (airtime != null && airtime > 0) {
      figures.push({
        value: formatAirtime(airtime, t),
        label: dryRun ? t('share_fig_airtime_would_save') : t('share_fig_airtime_saved'),
      });
    }
    const top = topReason(model);
    if (top) figures.push(top);
    const title = repeater
      ? t(dryRun ? 'share_filter_repeater_title_dry' : 'share_filter_repeater_title', { name })
      : t('share_filter_companion_title', { name });
    const text: CardText = {
      kicker: t('share_filter_kicker', { window: windowLabel }),
      title,
      figures,
    };
    return make({ ...model, airtimeMs: airtime }, text, heroLabel, title);
  }, [name, history, group, windowLabel, t, fmt, make, topReason]);
  return history.length >= 2 ? build : null;
}

const CFILTER_LABEL: Record<CompanionFilterCounterKey, string> = {
  malformed: 'cfilter_counter_malformed',
  age: 'cfilter_counter_age',
  path: 'cfilter_counter_path',
  sender: 'cfilter_counter_sender',
  text: 'cfilter_counter_text',
};

/** 5b for my own radio: the companion filter history RTFM-EV stores every minute. */
export function useCompanionFilterBuild(args: {
  name: string;
  history: CompanionFilterHistory | null;
  windowLabel: string;
}): Build | null {
  const { t, fmt, make, topReason } = useFilterCard('cfilter');
  const { name, history, windowLabel } = args;
  const build = useCallback(async () => {
    const keys = Object.keys(CFILTER_LABEL) as CompanionFilterCounterKey[];
    const model = buildFilterResult(
      keys.map((k) => ({ key: k, label: t(CFILTER_LABEL[k]), value: history?.totals[k] ?? null })),
      { bins: (history?.bins ?? []).map((b) => keys.reduce((s, k) => s + (b[k] ?? 0), 0)) }
    );
    const figures: CardFigure[] = [
      { value: fmt(model.total), label: t('share_filter_hero_hidden') },
    ];
    const top = topReason(model);
    if (top) figures.push(top);
    const title = t('share_filter_companion_title', { name });
    const text: CardText = {
      kicker: t('share_filter_kicker', { window: windowLabel }),
      title,
      figures,
    };
    return make(model, text, t('share_filter_hero_hidden'), title);
  }, [name, history, windowLabel, t, fmt, make, topReason]);
  return history ? build : null;
}

/** 5c: RTFM-EV's own filtering (Spam & bots tab), plus Spam Guard airtime. */
export function useRtfmFilterBuild(args: {
  report: FilterStatsReport | null;
  channel: string;
  channelLabel: string;
  windowLabel: string;
}): Build | null {
  const { t, fmt, make } = useFilterCard('spam');
  const { report, channel, channelLabel, windowLabel } = args;
  const build = useCallback(
    async (opts: ShareBuildOptions) => {
      if (!report) throw new Error('nothing to share');
      const tot = report.totals;
      const model = buildFilterResult(
        [
          { key: 'spam', label: t('mesh_filter_tile_spam'), value: tot.spam },
          { key: 'bot', label: t('mesh_filter_tile_bots'), value: tot.bot_now },
          { key: 'malformed', label: t('mesh_filter_tile_malformed'), value: tot.malformed },
          { key: 'duplicate', label: t('mesh_filter_tile_duplicates'), value: tot.duplicate },
        ],
        { bins: report.series.map((b) => b.flagged) }
      );
      // The reasons overlap (a message can be spam and a bot); the hero is the
      // de-duplicated count.
      const flagged = tot.flagged;
      const figures: CardFigure[] = [
        { value: fmt(tot.messages), label: t('share_fig_messages_read') },
        {
          value: t('share_fig_percent', {
            n: tot.messages ? ((flagged / tot.messages) * 100).toFixed(1) : '0',
          }),
          label: t('share_fig_flagged_share'),
        },
      ];
      // Spam Guard keeps airtime for all channels only, so not with a channel picked.
      if (!channel && report.spam_guard_enabled) {
        const air = await api
          .getSpamGuardAirtime(report.window.start_ts, report.window.end_ts)
          .catch(() => null);
        if (air && air.airtime_ms > 0) {
          figures.push({
            value: formatAirtime(air.airtime_ms, t),
            label: air.partial
              ? t('share_fig_airtime_saved_since', {
                  date: formatDateTime(air.from_ts * 1000, { day: 'numeric', month: 'short' }),
                })
              : t('share_fig_airtime_saved'),
          });
        }
      }
      const names = report.senders
        .map((s) => s.name)
        .filter(Boolean)
        .slice(0, 3);
      const title = t('share_filter_rtfm_title');
      const text: CardText = {
        kicker: t('share_filter_rtfm_kicker', { channels: channelLabel, window: windowLabel }),
        title,
        figures,
        quote:
          opts.flags.sources && names.length
            ? t('share_filter_top_sources', { names: names.join(', ') })
            : undefined,
      };
      return make({ ...model, total: flagged }, text, t('share_filter_hero_flagged'), title);
    },
    [report, channel, channelLabel, windowLabel, t, fmt, make]
  );
  return report && report.totals.messages > 0 ? build : null;
}

/** 5d: the host repeater's lifetime totals (no history kept, so a PNG only). */
export function useHostRepeaterFilterBuild(args: {
  stats: HostRepeaterStats | null;
}): Build | null {
  const { t, fmt, make } = useFilterCard('host-repeater');
  const { stats } = args;
  const build = useCallback(async () => {
    const life = stats?.lifetime;
    if (!life) throw new Error('nothing to share');
    const model = buildFilterResult([
      { key: 'drop', label: t('share_filter_host_drop'), value: life.would_drop },
      { key: 'forward', label: t('share_filter_host_forward'), value: life.would_forward },
    ]);
    const figures: CardFigure[] = [
      { value: fmt(life.observed), label: t('share_fig_observed') },
      { value: fmt(life.would_drop), label: t('share_filter_host_drop') },
    ];
    if ((life.saved_airtime_total_ms ?? 0) > 0) {
      figures.push({
        value: formatAirtime(life.saved_airtime_total_ms ?? 0, t),
        label: t('share_fig_airtime_saved_or_would'),
      });
    }
    const title = t('share_filter_host_title');
    const text: CardText = {
      kicker: t('share_filter_host_kicker', {
        since: formatDateTime(life.since * 1000, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        runs: life.runs,
        mode: !stats?.active
          ? t('share_filter_host_mode_off')
          : stats.tx?.armed
            ? t('share_filter_host_mode_armed')
            : t('share_filter_host_mode_shadow'),
      }),
      title,
      figures,
    };
    return make({ ...model, total: life.would_drop }, text, t('share_filter_host_drop'), title);
  }, [stats, t, fmt, make]);
  return stats?.lifetime ? build : null;
}
