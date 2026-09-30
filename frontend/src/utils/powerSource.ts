import type { PowerSourceOverride } from '../types';

// Power source of a node, read from the icons (or the word "solar") in its
// advertised name. Mirrors the EU-Meshcore-Analyzer classifier (power-util.js):
//   solar:   ☀ U+2600, 🌞 U+1F31E, 🔆 U+1F506, or the word "solar"
//   battery: 🔋 U+1F50B
//   mains:   ⚡ U+26A1, 🔌 U+1F50C
// Solar wins over mains, and solar + battery is its own category.
// Fork additions, checked before the icons:
//   - a contact's manual override (contacts.power_source) wins over everything;
//   - DTIS nodes (name starts with "DTIS |") run on a P1 Pro with solar, so
//     they are Solar + battery.

export type PowerSource = 'Mains' | 'Battery' | 'Solar' | 'SolarBattery' | 'Unknown';

export type { PowerSourceOverride };

/** Override values, in dropdown order. */
export const POWER_SOURCE_OVERRIDES: readonly PowerSourceOverride[] = [
  'mains',
  'battery',
  'solar',
  'solar_battery',
  'unknown',
];

const OVERRIDE_TO_SOURCE: Record<PowerSourceOverride, PowerSource> = {
  mains: 'Mains',
  battery: 'Battery',
  solar: 'Solar',
  solar_battery: 'SolarBattery',
  unknown: 'Unknown',
};

/** Map a stored override to its category; anything else (null, junk) is null. */
export function powerSourceFromOverride(value: string | null | undefined): PowerSource | null {
  return value != null && Object.prototype.hasOwnProperty.call(OVERRIDE_TO_SOURCE, value)
    ? OVERRIDE_TO_SOURCE[value as PowerSourceOverride]
    : null;
}

/** All categories, in display order. */
export const POWER_SOURCES: readonly PowerSource[] = [
  'Mains',
  'Battery',
  'Solar',
  'SolarBattery',
  'Unknown',
];

/** i18n key of each category's visible label. */
export const POWER_SOURCE_LABEL_KEY: Record<PowerSource, string> = {
  Mains: 'power_source_mains',
  Battery: 'power_source_battery',
  Solar: 'power_source_solar',
  SolarBattery: 'power_source_solar_battery',
  Unknown: 'power_source_unknown',
};

/** DTIS nodes: name starts with "DTIS |" (case-insensitive, spaces around the bar optional). */
export function isDtisName(name: string | null | undefined): boolean {
  return /^\s*dtis\s*\|/i.test(String(name ?? ''));
}

/** Power source detected from the node name alone (DTIS prefix, then icons). */
export function classifyPowerSource(name: string | null | undefined): PowerSource {
  if (isDtisName(name)) return 'SolarBattery';
  const n = String(name ?? '');
  const lower = n.toLowerCase();
  const solar =
    n.includes('☀') ||
    n.includes('\u{1F31E}') ||
    n.includes('\u{1F506}') ||
    lower.includes('solar');
  const battery = n.includes('\u{1F50B}');
  const mains = n.includes('⚡') || n.includes('\u{1F50C}');
  if (solar && battery) return 'SolarBattery';
  if (solar) return 'Solar';
  if (battery) return 'Battery';
  if (mains) return 'Mains';
  return 'Unknown';
}

/**
 * Effective power source of a contact: the manual override when set, else what
 * the name says (see classifyPowerSource).
 */
export function resolvePowerSource(contact: {
  name: string | null | undefined;
  power_source?: string | null;
}): PowerSource {
  return powerSourceFromOverride(contact.power_source) ?? classifyPowerSource(contact.name);
}

/**
 * Whether a node keeps running when the grid goes down. Battery, Solar and
 * Solar+battery carry their own supply (a solar node is assumed to have a
 * battery). Mains needs the grid, and Unknown cannot be assumed to survive, so
 * both count as going dark.
 */
export function survivesOutage(source: PowerSource): boolean {
  return source === 'Battery' || source === 'Solar' || source === 'SolarBattery';
}

/** Parse the persisted hidden-sources list, keeping only known categories. */
export function parseHiddenPowerSources(raw: string | null): Set<PowerSource> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (s): s is PowerSource =>
          typeof s === 'string' && (POWER_SOURCES as readonly string[]).includes(s)
      )
    );
  } catch {
    return new Set();
  }
}

export function serializeHiddenPowerSources(hidden: ReadonlySet<PowerSource>): string {
  return JSON.stringify([...hidden]);
}
