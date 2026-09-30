// Power source of a node, read from the icons (or the word "solar") in its
// advertised name. Mirrors the EU-Meshcore-Analyzer classifier (power-util.js):
//   solar:   ☀ U+2600, 🌞 U+1F31E, 🔆 U+1F506, or the word "solar"
//   battery: 🔋 U+1F50B
//   mains:   ⚡ U+26A1, 🔌 U+1F50C
// Solar wins over mains, and solar + battery is its own category.

export type PowerSource = 'Mains' | 'Battery' | 'Solar' | 'SolarBattery' | 'Unknown';

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

export function classifyPowerSource(name: string | null | undefined): PowerSource {
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
