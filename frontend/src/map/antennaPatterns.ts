// Radiation pattern estimates for the antenna register layer (pure, no map).
//
// What the register gives per antenna (Frequentiebesluit art. 20c): main beam
// bearing, power in dBW ERP in that direction, height from ground level to the
// antenna centre, and directional or not. It gives NO beamwidth, gain pattern
// or tilt, so the shape here is an assumption: a 65 degree wedge (a common
// horizontal beamwidth for mobile panel antennas) or a full circle for an omni
// antenna. The wedge reaches the free-space distance at which that antenna's
// signal falls to a chosen level. Buildings, terrain, downtilt and the vertical
// pattern all shorten the real reach, so this is an optimistic estimate.

import type { AntennaRegisterSite, AntennaRegisterTransmitter } from '../types';
import { ANTENNA_BAND_GROUPS, type AntennaBand } from './layers/antennaRegisterLayer';

/** Assumed horizontal beamwidth of a directional antenna (not in the register). */
export const ASSUMED_BEAMWIDTH_DEG = 65;
/** Received levels the wedge edge can be set to, dBm (0 dBi receive antenna). */
export const PATTERN_LEVELS_DBM = [-30, -40, -50, -60] as const;
export type PatternLevel = (typeof PATTERN_LEVELS_DBM)[number];
export const DEFAULT_PATTERN_LEVEL: PatternLevel = -40;
export const PATTERN_MIN_ZOOM_RANGE = [8, 18] as const;
export const DEFAULT_PATTERN_MIN_ZOOM = 12;

const EARTH_RADIUS_M = 6_371_008.8;
// ERP is relative to a half-wave dipole; EIRP (isotropic) is 2.15 dB higher.
const DIPOLE_GAIN_DBI = 2.15;

/** Centre frequency of a registered value such as "816 MHz" or "925-934.8 MHz". */
export function centreMhz(frequency: string): number | null {
  const m = /^\s*([\d.,]+)\s*(?:-\s*([\d.,]+))?\s*MHz\s*$/i.exec(frequency);
  if (!m) return null;
  const a = Number(m[1].replace(',', '.'));
  const b = m[2] ? Number(m[2].replace(',', '.')) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (a + b) / 2;
}

/**
 * Free-space distance in metres at which a transmitter of `erpDbw` (dBW ERP) at
 * `freqMhz` is received at `levelDbm` by an isotropic antenna. Friis:
 * FSPL(dB) = 20 log10(d_m) + 20 log10(f_MHz) - 27.55.
 */
export function freeSpaceReachM(erpDbw: number, freqMhz: number, levelDbm: number): number {
  const eirpDbm = erpDbw + 30 + DIPOLE_GAIN_DBI;
  const pathLossDb = eirpDbm - levelDbm;
  return 10 ** ((pathLossDb - 20 * Math.log10(freqMhz) + 27.55) / 20);
}

/** Point `distM` metres from (lat, lon) along `bearingDeg` (great circle). */
export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distM: number
): [number, number] {
  const toRad = Math.PI / 180;
  const d = distM / EARTH_RADIUS_M;
  const b = bearingDeg * toRad;
  const p1 = lat * toRad;
  const l1 = lon * toRad;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 =
    l1 +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((l2 / toRad + 540) % 360) - 180, p2 / toRad];
}

/** Closed ring of [lon, lat, z]: a wedge (centre, arc, centre) or, for `widthDeg` >= 360, a circle. */
export function sectorRing(
  lat: number,
  lon: number,
  bearingDeg: number,
  widthDeg: number,
  radiusM: number,
  z: number,
  steps = 16
): [number, number, number][] {
  const ring: [number, number, number][] = [];
  if (widthDeg >= 360) {
    const n = steps * 3;
    for (let i = 0; i <= n; i++) {
      const [x, y] = destinationPoint(lat, lon, (360 * i) / n, radiusM);
      ring.push([x, y, z]);
    }
    return ring;
  }
  ring.push([lon, lat, z]);
  const start = bearingDeg - widthDeg / 2;
  for (let i = 0; i <= steps; i++) {
    const [x, y] = destinationPoint(lat, lon, start + (widthDeg * i) / steps, radiusM);
    ring.push([x, y, z]);
  }
  ring.push([lon, lat, z]);
  return ring;
}

export interface PatternPolygon {
  siteId: number;
  ring: [number, number, number][];
  /** "868" | "433": the mesh band group, for colour. */
  band: AntennaBand;
  radiusM: number;
}

function transmitterRings(
  site: AntennaRegisterSite,
  tx: AntennaRegisterTransmitter,
  levelDbm: number,
  elevated: boolean
): { ring: [number, number, number][]; radiusM: number }[] {
  const freq = centreMhz(tx.frequency);
  if (tx.power_dbw == null || freq == null) return [];
  const radiusM = freeSpaceReachM(tx.power_dbw, freq, levelDbm);
  // Some antennas are registered below ground level (tunnels); keep those at 0.
  const z = elevated ? Math.max(0, tx.height_m ?? site.max_height_m ?? 0) : 0;
  const rings = tx.bearings_deg.map((b) => ({
    ring: sectorRing(site.lat, site.lon, b, ASSUMED_BEAMWIDTH_DEG, radiusM, z),
    radiusM,
  }));
  if (tx.omni || tx.bearings_deg.length === 0) {
    rings.push({ ring: sectorRing(site.lat, site.lon, 0, 360, radiusM, z), radiusM });
  }
  return rings;
}

/**
 * One polygon per sector (or omni circle) of every transmitter in the chosen
 * mesh band's group. Largest first, so smaller wedges draw on top. With
 * `elevated` the rings sit at the antenna's registered height (3D view).
 */
export function buildPatternPolygons(
  sites: AntennaRegisterSite[],
  band: AntennaBand,
  levelDbm: number,
  elevated: boolean
): PatternPolygon[] {
  const group = ANTENNA_BAND_GROUPS[band];
  const out: PatternPolygon[] = [];
  for (const site of sites) {
    for (const tx of site.transmitters) {
      if (!group.includes(tx.band)) continue;
      for (const { ring, radiusM } of transmitterRings(site, tx, levelDbm, elevated)) {
        out.push({ siteId: site.id, ring, band, radiusM });
      }
    }
  }
  return out.sort((a, b) => b.radiusM - a.radiusM);
}
