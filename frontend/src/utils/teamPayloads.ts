/**
 * Parsing for MeshCore TEAM payloads sent as ordinary channel text.
 *
 * MeshCore TEAM (github.com/tmacinc/MeshCore-TEAM) and signalk-meshcore
 * (github.com/Banzarykey/signalk-meshcore) put tracking data on a channel as
 * prefixed text. Mirrors `app/team_payloads.py`, which documents the formats
 * in full. Everything is parsed; the only messages built here for sending are
 * a single #WAY: waypoint (`buildTeamWaypointPayload`) and a #TEL: beacon
 * (`buildTeamTelemetryPayload`), both only as composer text.
 *
 *   #TEL:<base64>   11 bytes: lat, lon (int32 BE x 1e7), radio battery, phone
 *                   battery, forwarding status
 *   #T:<base64>     same first 10 bytes, then node count + neighbour bitmap
 *   #WAY:meshId|name|lat|lon|description|type|routeCoords[|n/N]
 *   #WRC:meshId|routeCoords|n/N            route continuation
 *   #CAP:<version>:<flags>[:keyPrefix:appId:alias]   capability advert
 *   #CAP:R:<keyPrefix>:<radioName>         advert request
 *
 * Formats are ported from MeshCore-TEAM lib/models (telemetry_message.dart,
 * topology_message.dart, waypoint_mesh_message.dart, capability_message.dart).
 * A #TEL: with forwarding status 0 is treated as signalk-meshcore: TEAM's
 * encoder never sends 0 there, and signalk-meshcore always does.
 */

import type { VesselType } from '../types';
import { isValidLocation } from './pathUtils';

export interface TeamBeaconPayload {
  type: 'beacon';
  kind: 'tel' | 'topology';
  source: 'team' | 'signalk';
  /** Null without a usable fix (unset or out of range). */
  lat: number | null;
  lon: number | null;
  radioBatteryMv: number | null;
  phoneBatteryMv: number | null;
  /** signalk-meshcore only. */
  phoneBatteryPct: number | null;
  /** Radio tracking on its own, no phone attached. */
  autonomous: boolean;
  /** TEAM #TEL: only. */
  needsForwarding: boolean | null;
  maxPathObserved: number | null;
  /** #T: only. */
  nodeCount: number | null;
  neighborCount: number | null;
}

export interface TeamWaypointPayload {
  type: 'waypoint';
  meshId: string | null;
  name: string;
  lat: number;
  lon: number;
  description: string;
  waypointType: string;
  /** Route colour as #rrggbb. */
  color: string | null;
  routeChunk: string;
  partNum: number | null;
  totalParts: number | null;
}

export interface TeamRoutePartPayload {
  type: 'routePart';
  meshId: string;
  routeChunk: string;
  partNum: number;
  totalParts: number;
}

export interface TeamCapabilityPayload {
  type: 'capability';
  version: number;
  flags: number;
  customFirmware: boolean;
  forwardingCapable: boolean;
  autonomousCapable: boolean;
  autonomousEnabled: boolean;
  smartForwardingActive: boolean;
  radioKeyPrefix: string | null;
  appId: string | null;
  /** Null for v1; empty means no alias set. */
  alias: string | null;
}

export interface TeamCapabilityRequestPayload {
  type: 'capabilityRequest';
  targetKeyPrefix: string | null;
  targetRadioName: string;
}

export type TeamPayload =
  | TeamBeaconPayload
  | TeamWaypointPayload
  | TeamRoutePartPayload
  | TeamCapabilityPayload
  | TeamCapabilityRequestPayload;

const TEL_PREFIX = '#TEL:';
const TOPOLOGY_PREFIX = '#T:';
const WAYPOINT_PREFIX = '#WAY:';
const ROUTE_PART_PREFIX = '#WRC:';
const CAPABILITY_PREFIX = '#CAP:';
const CAPABILITY_REQUEST_PREFIX = '#CAP:R:';

const TEL_SIZE = 11;
const TOPOLOGY_HEADER_SIZE = 11;
const BATTERY_MIN_MV = 2750;
const BATTERY_STEP_MV = 6;
const AUTONOMOUS = 0xff;
const MAX_ALIAS_BYTES = 24;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const PART_INFO_PATTERN = /^(\d+)\/(\d+)$/;
const COLOR_PREFIX_PATTERN = /^@C:([0-9A-Fa-f]{8})/;
const KEY_PREFIX_PATTERN = /^[0-9a-f]{12}$/;
const APP_ID_PATTERN = /^[0-9a-f]{16}$/;
const HEX_PATTERN = /^[0-9A-Fa-f]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_PATTERN = /[\x00-\x1f\x7f]/g;

function decodeBase64(payload: string): Uint8Array | null {
  if (!BASE64_PATTERN.test(payload)) return null;
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

function batteryMv(encoded: number): number | null {
  // 0xFF is outside TEAM's range (its encoder stops at 254); signalk-meshcore
  // clamps to it, so the real voltage is unknown.
  if (encoded <= 1 || encoded === 0xff) return null;
  return BATTERY_MIN_MV + (encoded - 2) * BATTERY_STEP_MV;
}

function position(raw: Uint8Array): { lat: number | null; lon: number | null } {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const lat = view.getInt32(0) / 1e7;
  const lon = view.getInt32(4) / 1e7;
  return isValidLocation(lat, lon) ? { lat, lon } : { lat: null, lon: null };
}

function parseTelemetry(payload: string): TeamBeaconPayload | null {
  const raw = decodeBase64(payload);
  if (!raw || raw.length !== TEL_SIZE) return null;
  const radio = raw[8];
  const phone = raw[9];
  const forwarding = raw[10];
  if (forwarding === 0) {
    return {
      type: 'beacon',
      kind: 'tel',
      source: 'signalk',
      ...position(raw),
      radioBatteryMv: batteryMv(radio),
      phoneBatteryMv: null,
      phoneBatteryPct: phone <= 100 ? phone : null,
      autonomous: false,
      needsForwarding: null,
      maxPathObserved: null,
      nodeCount: null,
      neighborCount: null,
    };
  }
  const autonomous = phone === AUTONOMOUS;
  const status = forwarding - 1;
  return {
    type: 'beacon',
    kind: 'tel',
    source: 'team',
    ...position(raw),
    radioBatteryMv: batteryMv(radio),
    phoneBatteryMv: autonomous ? null : batteryMv(phone),
    phoneBatteryPct: null,
    autonomous,
    needsForwarding: (status & 0x01) === 1,
    maxPathObserved: (status >> 1) & 0x7f,
    nodeCount: null,
    neighborCount: null,
  };
}

function parseTopology(payload: string): TeamBeaconPayload | null {
  const raw = decodeBase64(payload);
  if (!raw || raw.length < TOPOLOGY_HEADER_SIZE) return null;
  const nodeCount = raw[10];
  const bitmapSize = Math.floor((nodeCount + 7) / 8);
  if (raw.length < TOPOLOGY_HEADER_SIZE + bitmapSize) return null;
  let neighborCount = 0;
  for (let i = 0; i < nodeCount; i++) {
    if ((raw[TOPOLOGY_HEADER_SIZE + (i >> 3)] >> (i & 7)) & 1) neighborCount++;
  }
  const phone = raw[9];
  const autonomous = phone === AUTONOMOUS;
  return {
    type: 'beacon',
    kind: 'topology',
    source: 'team',
    ...position(raw),
    radioBatteryMv: batteryMv(raw[8]),
    phoneBatteryMv: autonomous ? null : batteryMv(phone),
    phoneBatteryPct: null,
    autonomous,
    needsForwarding: null,
    maxPathObserved: null,
    nodeCount,
    neighborCount,
  };
}

function coordinate(text: string): number | null {
  const trimmed = text.trim();
  return NUMBER_PATTERN.test(trimmed) ? Number.parseFloat(trimmed) : null;
}

function splitColor(description: string): { description: string; color: string | null } {
  const match = COLOR_PREFIX_PATTERN.exec(description);
  if (!match) return { description, color: null };
  return {
    description: description.slice(match[0].length),
    color: `#${match[1].slice(2).toLowerCase()}`,
  };
}

function parseWaypoint(data: string): TeamWaypointPayload | null {
  const parts = data.split('|');
  let meshId = '';
  let routeChunk = '';
  let partInfo: RegExpExecArray | null = null;
  let fields: string[];
  if (parts.length >= 6) {
    meshId = parts[0];
    fields = parts.slice(1, 6);
    routeChunk = parts.length >= 7 ? parts[6] : '';
    partInfo = parts.length >= 8 ? PART_INFO_PATTERN.exec(parts[7]) : null;
  } else if (parts.length === 5) {
    fields = parts;
  } else {
    return null;
  }
  const [name, latText, lonText, rawDescription, waypointType] = fields;
  const lat = coordinate(latText);
  const lon = coordinate(lonText);
  if (lat === null || lon === null || !isValidLocation(lat, lon)) return null;
  return {
    type: 'waypoint',
    meshId: meshId || null,
    name,
    lat,
    lon,
    ...splitColor(rawDescription),
    waypointType,
    routeChunk,
    partNum: partInfo ? Number.parseInt(partInfo[1], 10) : null,
    totalParts: partInfo ? Number.parseInt(partInfo[2], 10) : null,
  };
}

function parseRoutePart(data: string): TeamRoutePartPayload | null {
  const parts = data.split('|');
  if (parts.length < 3) return null;
  const partInfo = PART_INFO_PATTERN.exec(parts[2]);
  if (!partInfo) return null;
  return {
    type: 'routePart',
    meshId: parts[0],
    routeChunk: parts[1],
    partNum: Number.parseInt(partInfo[1], 10),
    totalParts: Number.parseInt(partInfo[2], 10),
  };
}

function sanitizeAlias(alias: string): string {
  const cleaned = alias.replace(CONTROL_CHARS_PATTERN, '').trim();
  const encoder = new TextEncoder();
  if (encoder.encode(cleaned).length <= MAX_ALIAS_BYTES) return cleaned;
  let out = '';
  let bytes = 0;
  for (const char of cleaned) {
    const size = encoder.encode(char).length;
    if (bytes + size > MAX_ALIAS_BYTES) break;
    out += char;
    bytes += size;
  }
  return out.trim();
}

function parseCapabilityRequest(data: string): TeamCapabilityRequestPayload | null {
  const separator = data.indexOf(':');
  if (separator < 0) return null;
  const keyField = data.slice(0, separator).toLowerCase();
  const name = data.slice(separator + 1).trim();
  if (!name) return null;
  return {
    type: 'capabilityRequest',
    targetKeyPrefix: KEY_PREFIX_PATTERN.test(keyField) ? keyField : null,
    targetRadioName: name,
  };
}

function parseCapability(data: string): TeamCapabilityPayload | null {
  const parts = data.split(':');
  if (parts.length < 2 || !/^\d+$/.test(parts[0]) || !HEX_PATTERN.test(parts[1])) return null;
  const version = Number.parseInt(parts[0], 10);
  if (version < 1) return null;
  const flags = Number.parseInt(parts[1], 16) & 0xff;
  let radioKeyPrefix: string | null = null;
  let appId: string | null = null;
  let alias: string | null = null;
  if (parts.length > 2) {
    const keyField = parts[2].toLowerCase();
    radioKeyPrefix = KEY_PREFIX_PATTERN.test(keyField) ? keyField : null;
    // The alias is last and may contain ":". An early v2 sender put it straight
    // after the key prefix, without an app id.
    let aliasStart = 3;
    if (parts.length >= 5) {
      const appField = parts[3].toLowerCase();
      if (appField === '-' || APP_ID_PATTERN.test(appField)) {
        appId = appField === '-' ? null : appField;
        aliasStart = 4;
      }
    }
    alias = sanitizeAlias(parts.slice(aliasStart).join(':'));
  }
  return {
    type: 'capability',
    version,
    flags,
    customFirmware: (flags & 0x01) !== 0,
    forwardingCapable: (flags & 0x02) !== 0,
    autonomousCapable: (flags & 0x04) !== 0,
    autonomousEnabled: (flags & 0x08) !== 0,
    smartForwardingActive: (flags & 0x10) !== 0,
    radioKeyPrefix,
    appId,
    alias,
  };
}

/**
 * Parse a MeshCore TEAM payload. `text` is the message body without the
 * channel sender prefix. Returns null when it is not a valid TEAM payload.
 */
export function parseTeamPayload(text: string): TeamPayload | null {
  const body = text.trim();
  if (body.startsWith(TEL_PREFIX)) return parseTelemetry(body.slice(TEL_PREFIX.length));
  if (body.startsWith(TOPOLOGY_PREFIX)) return parseTopology(body.slice(TOPOLOGY_PREFIX.length));
  if (body.startsWith(WAYPOINT_PREFIX)) return parseWaypoint(body.slice(WAYPOINT_PREFIX.length));
  if (body.startsWith(ROUTE_PART_PREFIX)) {
    return parseRoutePart(body.slice(ROUTE_PART_PREFIX.length));
  }
  if (body.startsWith(CAPABILITY_REQUEST_PREFIX)) {
    return parseCapabilityRequest(body.slice(CAPABILITY_REQUEST_PREFIX.length));
  }
  if (body.startsWith(CAPABILITY_PREFIX)) {
    return parseCapability(body.slice(CAPABILITY_PREFIX.length));
  }
  return null;
}

/** `lat,lon~lat,lon` route coordinates as [lat, lon] points; bad entries are skipped. */
export function decodeTeamRoute(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  for (const chunk of encoded.split('~')) {
    const pair = chunk.split(',');
    if (pair.length !== 2) continue;
    const lat = coordinate(pair[0]);
    const lon = coordinate(pair[1]);
    if (lat !== null && lon !== null && isValidLocation(lat, lon)) points.push([lat, lon]);
  }
  return points;
}

// TEAM's WaypointType enum (lib/models/waypoint.dart), sent upper case.
const WAYPOINT_ICONS: Record<string, string> = {
  camp: '⛺',
  meetup: '📍',
  danger: '⚠️',
  game: '🦌',
  stand: '🪑',
  water: '💧',
  vehicle: '🚗',
  route: '⤴',
  custom: '📌',
};

/** TEAM waypoint types that have a translated name (`team_waypoint_type_<type>`). */
export const TEAM_WAYPOINT_TYPES = Object.keys(WAYPOINT_ICONS);

/** The TEAM waypoint type in lower case, or `custom` for one TEAM does not define. */
export function teamWaypointKind(waypointType: string): string {
  const type = waypointType.toLowerCase();
  return type in WAYPOINT_ICONS ? type : 'custom';
}

/** Icon TEAM shows for a waypoint type; a pin for types it does not define. */
export function teamWaypointIcon(waypointType: string): string {
  return WAYPOINT_ICONS[teamWaypointKind(waypointType)];
}

/**
 * What kind of sender a beacon comes from, as far as the payload tells:
 * a boat (signalk-meshcore), a radio tracking on its own, or a person with
 * the TEAM app on a phone. The payload carries no vessel or AIS type.
 */
export type TeamBeaconKind = 'boat' | 'radio' | 'person';

export function teamBeaconKind(beacon: {
  source: 'team' | 'signalk';
  autonomous: boolean;
}): TeamBeaconKind {
  if (beacon.source === 'signalk') return 'boat';
  return beacon.autonomous ? 'radio' : 'person';
}

const BEACON_ICONS: Record<TeamBeaconKind, string> = { boat: '⛵', radio: '📡', person: '🚶' };

/** Icon per sender kind, for every beacon kind (map pins use the same ones). */
export const TEAM_BEACON_ICONS: Readonly<Record<TeamBeaconKind, string>> = BEACON_ICONS;

/** Vessel types a contact can be given by hand, in menu order. */
export const TEAM_VESSEL_TYPES: VesselType[] = [
  'sailing',
  'motor',
  'fishing',
  'cargo',
  'passenger',
  'tug',
  'sar',
  'other',
];

/** Icon per hand-set vessel type. */
export const TEAM_VESSEL_ICONS: Readonly<Record<VesselType, string>> = {
  sailing: '⛵',
  motor: '🚤',
  fishing: '🎣',
  cargo: '🚢',
  passenger: '⛴️',
  tug: '⚓',
  sar: '🆘',
  other: '🛥️',
};

/**
 * Icon for a beacon: the sending contact's hand-set vessel type when it has
 * one, else the kind of sender the payload shows.
 */
export function teamBeaconIcon(
  beacon: { source: 'team' | 'signalk'; autonomous: boolean },
  vesselType?: VesselType | null
) {
  return vesselType ? TEAM_VESSEL_ICONS[vesselType] : BEACON_ICONS[teamBeaconKind(beacon)];
}

/** Battery voltage as volts with two decimals, e.g. 3998 -> "4.00". */
export function formatTeamBatteryVolts(millivolts: number): string {
  return (millivolts / 1000).toFixed(2);
}

function randomMeshId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build a TEAM waypoint message: `#WAY:meshId|name|lat|lon||TYPE|`. Pipes and
 * line breaks are kept out of the name (pipes delimit the fields). TEAM
 * matches a re-sent waypoint by mesh id, so a fresh one is made when none is
 * given. Sending is the user's own action; nothing here transmits.
 */
export function buildTeamWaypointPayload(waypoint: {
  meshId?: string;
  name: string;
  lat: number;
  lon: number;
  waypointType: string;
}): string {
  const name = waypoint.name
    .replace(/\|/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const meshId = waypoint.meshId ?? randomMeshId();
  const type = waypoint.waypointType.toUpperCase();
  return `${WAYPOINT_PREFIX}${meshId}|${name}|${waypoint.lat.toFixed(6)}|${waypoint.lon.toFixed(6)}||${type}|`;
}

/** TEAM's battery byte: 1 for unknown, else 2-254 (clamped to its range). */
function encodeBattery(millivolts: number | null | undefined): number {
  if (!millivolts) return 1;
  return Math.max(
    2,
    Math.min(254, Math.floor((millivolts - BATTERY_MIN_MV) / BATTERY_STEP_MV) + 2)
  );
}

/**
 * Build a TEAM `#TEL:` beacon for a radio with no phone attached. Mirrors
 * `encode_telemetry` in `app/team_payloads.py`: unpadded Base64, phone battery
 * "unknown" (1), forwarding status 1 (no forwarding needed, no path observed).
 * TEAM only reads it when it is the whole message. Sending is the user's own
 * action; nothing here transmits.
 */
export function buildTeamTelemetryPayload(
  lat: number,
  lon: number,
  radioBatteryMv?: number | null
): string {
  const raw = new Uint8Array(TEL_SIZE);
  const view = new DataView(raw.buffer);
  view.setInt32(0, Math.round(lat * 1e7));
  view.setInt32(4, Math.round(lon * 1e7));
  raw[8] = encodeBattery(radioBatteryMv);
  raw[9] = 1;
  raw[10] = 1;
  return TEL_PREFIX + btoa(String.fromCharCode(...raw)).replace(/=+$/, '');
}

/**
 * How a shared location is written into the composer when it is not the
 * default meshcore-open marker: a TEAM waypoint of some type, or a TEAM beacon.
 */
export type TeamLocationFormat = { teamWaypointType: string } | { teamBeacon: true };
