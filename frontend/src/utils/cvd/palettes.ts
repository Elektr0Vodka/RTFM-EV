/**
 * Colourblind palettes: one per colour vision deficiency type and per tone
 * (the surface the colours sit on). Off returns null for the semantic tokens
 * (the theme keeps its own) and today's exact data colours, so Off looks the
 * same as before this module existed.
 *
 * Sources: the status colours start from Okabe and Ito (2008), "Color
 * Universal Design" (blue / yellow / vermillion for protan and deutan), and a
 * teal / amber / crimson set for tritan, which loses the blue-yellow axis.
 * Lightness was then tuned so text passes 4.5:1 on every theme's cards
 * (Windows 95's grey cards are the hardest case on the light side). Data
 * colours were picked by a maximin search over Okabe-Ito hue anchors, capped
 * in saturation, against the tests in src/test/cvdPalettes.test.ts.
 */
import type { CvdMode, Tone } from '../accessibility';
import {
  NODE_RECENCY_COLORS,
  NODE_TYPE_STROKE,
  type RecencyTier,
} from '../../map/layers/nodesLayer';
import { HOP_COLORS, RECEIVER_COLOR, SENDER_COLOR } from '../../map/routeMapVisuals';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
} from '../../types';

/** Status colours behind the CSS semantic tokens (hex). */
export interface SemanticColors {
  success: string;
  successFg: string;
  warning: string;
  warningFg: string;
  destructive: string;
  destructiveFg: string;
  info: string;
  infoFg: string;
  statusConnected: string;
  statusDisconnected: string;
}

/** Colours that carry meaning on maps and charts (hex). */
export interface DataColors {
  /** SNR ramp stops at -20 / 0 / 10 dB. */
  signal: { bad: string; mid: string; good: string };
  recency: Record<RecencyTier, string>;
  /** Map node stroke per contact role. */
  roles: Record<number, string>;
  hops: string[];
  sender: string;
  receiver: string;
  /** Categorical chart series, in order. */
  series: string[];
}

/**
 * Smallest CIEDE2000 difference two colours that must be told apart may have
 * after CVD simulation. 10 is about where two flat swatches side by side stop
 * being a judgement call; most pairs here sit well above 14.
 */
export const MIN_SIMULATED_DE2000 = 10;

type ActiveMode = Exclude<CvdMode, 'off'>;

const WHITE = '#ffffff';
const INK = '#0b0b0b';

function semantic(
  success: string,
  warning: string,
  destructive: string,
  info: string,
  fg: string,
  infoFg: string
): SemanticColors {
  return {
    success,
    successFg: fg,
    warning,
    warningFg: fg,
    destructive,
    destructiveFg: fg,
    info,
    infoFg,
    statusConnected: success,
    statusDisconnected: destructive,
  };
}

const SEMANTIC: Record<ActiveMode, Record<Tone, SemanticColors>> = {
  protan: {
    dark: semantic('#56b4e9', '#f0e442', '#ff7a45', '#7badc6', INK, INK),
    light: semantic('#084a85', '#6b4800', '#940f47', '#124468', WHITE, WHITE),
  },
  deutan: {
    dark: semantic('#56b4e9', '#f0e442', '#ff7a45', '#7badc6', INK, INK),
    light: semantic('#084a85', '#6b4800', '#940f47', '#124468', WHITE, WHITE),
  },
  tritan: {
    dark: semantic('#2fd3a6', '#f5a623', '#ff5c8a', '#7badc6', INK, INK),
    light: semantic('#06554a', '#5e4800', '#9a0c18', '#124468', WHITE, WHITE),
  },
};

function data(
  signal: [good: string, mid: string, bad: string],
  recency: [recent: string, today: string, stale: string, old: string],
  roles: [client: string, repeater: string, room: string, sensor: string],
  series: string[],
  hops: string[],
  [sender, receiver]: [string, string]
): DataColors {
  return {
    signal: { good: signal[0], mid: signal[1], bad: signal[2] },
    recency: { recent: recency[0], today: recency[1], stale: recency[2], old: recency[3] },
    roles: {
      [CONTACT_TYPE_CLIENT]: roles[0],
      [CONTACT_TYPE_REPEATER]: roles[1],
      [CONTACT_TYPE_ROOM]: roles[2],
      [CONTACT_TYPE_SENSOR]: roles[3],
    },
    hops,
    sender,
    receiver,
    series,
  };
}

const DATA: Record<ActiveMode, Record<Tone, DataColors>> = {
  protan: {
    dark: data(
      ['#1980e6', '#bfb540', '#d23a2d'],
      ['#b6ecf7', '#195ee6', '#e78523', '#4d7345'],
      ['#1991e6', '#e69119', '#d22d80', '#19e6a1'],
      ['#2b88ca', '#e9ad35', '#19e6b3', '#c13215', '#e3abc7'],
      ['#23e795', '#ca2b60', '#e6f910', '#8346d8', '#e0a3ad', '#f9ab10', '#38eafa', '#1b7e65'],
      ['#1991e6', '#db4d06']
    ),
    light: data(
      ['#2d80d2', '#918930', '#a51212'],
      ['#209797', '#192be6', '#c27529', '#1b2013'],
      ['#2c8ae8', '#b97c27', '#e61980', '#07402d'],
      ['#1980e6', '#c17915', '#0c6e4e', '#32180b', '#e72385'],
      ['#0d6677', '#e72354', '#8a822e', '#309171', '#2013ae', '#ca2bca', '#12361b', '#8a4d0f'],
      ['#1a8af9', '#6e0c2d']
    ),
  },
  deutan: {
    dark: data(
      ['#1980e6', '#d2c52d', '#d23a2d'],
      ['#d1f7fa', '#2d64d2', '#e68019', '#497345'],
      ['#1991e6', '#e69119', '#d22d80', '#19e6a1'],
      ['#1991e6', '#ebb447', '#19e6b3', '#c13215', '#e689cf'],
      ['#f96b06', '#eba2bb', '#23d6e7', '#832efa', '#d31766', '#f9d006', '#6d810e', '#10f998'],
      ['#569bfb', '#037777']
    ),
    light: data(
      ['#2d80d2', '#918930', '#972020'],
      ['#209797', '#192be6', '#c27529', '#201d13'],
      ['#188bdc', '#b07f3b', '#e61990', '#052e20'],
      ['#1980e6', '#ca7016', '#119c6e', '#32110b', '#e619a2'],
      ['#f90606', '#174532', '#6e1d0c', '#8a0f61', '#f924c4', '#2d1af9', '#7a6d29', '#119c6e'],
      ['#1980e6', '#0e1343']
    ),
  },
  tritan: {
    dark: data(
      ['#19e6e6', '#e6a219', '#d22d64'],
      ['#19e6e6', '#195ee6', '#7e651b', '#e4d2db'],
      ['#1991e6', '#e69119', '#d22d80', '#19e6a1'],
      ['#408abf', '#ecb851', '#19e6b3', '#b83d14', '#eb47c2'],
      ['#54ef06', '#0657f9', '#8b5e04', '#f9d210', '#c2abe3', '#db06a5', '#2e8a6b', '#c9ede7'],
      ['#10abf9', '#f9062f']
    ),
    light: data(
      ['#084449', '#b18225', '#b92758'],
      ['#209797', '#192be6', '#c27529', '#201d13'],
      ['#188bdc', '#b07f3b', '#b12577', '#052e20'],
      ['#2d8dd2', '#a88338', '#07402d', '#491308', '#e619a2'],
      ['#0e4781', '#7204a9', '#a66afb', '#309139', '#4d4d1a', '#fa2e94', '#b07f3b', '#913041'],
      ['#1a8af9', '#f91b06']
    ),
  },
};

/** Today's data colours, used when the mode is off. */
const OFF_DATA: DataColors = {
  signal: { bad: '#f59e0b', mid: '#3b82f6', good: '#22c55e' },
  recency: NODE_RECENCY_COLORS,
  roles: NODE_TYPE_STROKE,
  hops: HOP_COLORS,
  sender: SENDER_COLOR,
  receiver: RECEIVER_COLOR,
  series: ['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'],
};

/** Status colours for the CSS tokens, or null when off (the theme keeps its own). */
export function getSemanticColors(mode: CvdMode, tone: Tone): SemanticColors | null {
  return mode === 'off' ? null : SEMANTIC[mode][tone];
}

/** Map and chart colours for this mode and tone; today's colours when off. */
export function getDataColors(mode: CvdMode, tone: Tone): DataColors {
  return mode === 'off' ? OFF_DATA : DATA[mode][tone];
}
