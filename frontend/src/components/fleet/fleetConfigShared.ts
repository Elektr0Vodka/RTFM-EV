/**
 * Pure helpers of the fleet config library: turning a stored config document
 * into rows to show, comparing two documents, and naming an exported file.
 *
 * A stored document holds `{"$secret": <vault id or null>}` where the file had
 * a secret. These helpers only ever see that placeholder, never a value.
 */
import type { FleetConfigProfile } from '../../types';

export type ConfigDocument = Record<string, unknown>;

/** One value of a document: its text, or the fact that it is a secret. */
export type ConfigLeaf = { secret: false; text: string } | { secret: true; id: number | null };

export interface ConfigRow {
  /** Path inside its section, parts joined by `/` (keys hold dots). */
  path: string;
  leaf: ConfigLeaf;
}

export interface ConfigSection {
  /** Top-level key of the file; `''` holds the loose top-level values. */
  key: string;
  rows: ConfigRow[];
}

export interface ConfigDiffRow {
  path: string;
  /** Null: the key is not in that document. */
  left: ConfigLeaf | null;
  right: ConfigLeaf | null;
}

export interface ConfigDiff {
  changed: ConfigDiffRow[];
  /** Secrets with no stored value on at least one side. */
  uncompared: string[];
  same: number;
}

export const TOOLBOX_PROFILES: FleetConfigProfile[] = ['stock', 'dmc_repeater', 'dmc_observer'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlaceholder(value: unknown): value is { $secret: number | null } {
  return isObject(value) && '$secret' in value;
}

function leafOf(value: unknown): ConfigLeaf {
  if (isPlaceholder(value)) {
    return { secret: true, id: typeof value.$secret === 'number' ? value.$secret : null };
  }
  return { secret: false, text: typeof value === 'string' ? value : JSON.stringify(value) };
}

function isBranch(value: unknown): boolean {
  if (isPlaceholder(value)) return false;
  if (Array.isArray(value)) return value.length > 0;
  return isObject(value) && Object.keys(value).length > 0;
}

function entriesOf(branch: unknown): [string, unknown][] {
  return Array.isArray(branch)
    ? branch.map((item, index) => [String(index), item])
    : Object.entries(branch as Record<string, unknown>);
}

function collect(value: unknown, path: string, rows: ConfigRow[]): void {
  if (!isBranch(value)) {
    rows.push({ path, leaf: leafOf(value) });
    return;
  }
  for (const [key, item] of entriesOf(value)) collect(item, path ? `${path}/${key}` : key, rows);
}

/** The document as sections of rows, in the order of the file. */
export function configSections(document: ConfigDocument): ConfigSection[] {
  const loose: ConfigRow[] = [];
  const sections: ConfigSection[] = [];
  for (const [key, value] of Object.entries(document)) {
    if (isBranch(value)) {
      const rows: ConfigRow[] = [];
      collect(value, '', rows);
      sections.push({ key, rows });
    } else {
      loose.push({ path: key, leaf: leafOf(value) });
    }
  }
  return loose.length > 0 ? [{ key: '', rows: loose }, ...sections] : sections;
}

function flatten(document: ConfigDocument): Map<string, { leaf: ConfigLeaf; json: string }> {
  const values = new Map<string, { leaf: ConfigLeaf; json: string }>();
  const walk = (value: unknown, path: string) => {
    if (isBranch(value)) {
      for (const [key, item] of entriesOf(value)) walk(item, path ? `${path}/${key}` : key);
      return;
    }
    values.set(path, { leaf: leafOf(value), json: JSON.stringify(value) });
  };
  walk(document, '');
  return values;
}

/**
 * What differs between two stored documents. Secrets are compared by vault
 * entry only: the same entry is the same secret, another entry is reported as
 * a change, and a secret without a stored value cannot be compared at all.
 */
export function diffConfigs(left: ConfigDocument, right: ConfigDocument): ConfigDiff {
  const a = flatten(left);
  const b = flatten(right);
  const diff: ConfigDiff = { changed: [], uncompared: [], same: 0 };
  for (const [path, mine] of a) {
    const theirs = b.get(path);
    if (theirs === undefined) {
      diff.changed.push({ path, left: mine.leaf, right: null });
    } else if (
      mine.leaf.secret &&
      theirs.leaf.secret &&
      (mine.leaf.id === null || theirs.leaf.id === null)
    ) {
      diff.uncompared.push(path);
    } else if (mine.json === theirs.json) {
      diff.same += 1;
    } else {
      diff.changed.push({ path, left: mine.leaf, right: theirs.leaf });
    }
  }
  for (const [path, theirs] of b) {
    if (!a.has(path)) diff.changed.push({ path, left: null, right: theirs.leaf });
  }
  return diff;
}

function safeName(text: unknown): string {
  return typeof text === 'string' ? text.replace(/[^a-zA-Z0-9_-]/g, '_') : '';
}

/**
 * The name of an exported file. A toolbox file is named the way the toolbox
 * names its own export (`config-<role>-<name>.json`).
 */
export function configFilename(
  profile: FleetConfigProfile,
  role: string | null,
  document: ConfigDocument
): string {
  if (profile === 'companion_v1') return `${safeName(document.name) || 'radio'}-config.json`;
  const vars = isObject(document.vars) ? document.vars : {};
  return `config-${safeName(role) || 'unknown'}-${safeName(vars.name) || 'noname'}.json`;
}

/** The role in a toolbox export's file name, or `''` when it has none. */
export function roleFromFilename(filename: string): string {
  const match = /^config-([A-Za-z0-9_]+)-.*\.json$/i.exec(filename);
  return match && match[1] !== 'unknown' ? match[1] : '';
}

/** The profiles a document can be labelled with: those of its file format. */
export function fittingProfiles(document: ConfigDocument): FleetConfigProfile[] {
  return isObject(document.vars) ? TOOLBOX_PROFILES : ['companion_v1'];
}
