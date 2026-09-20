/**
 * MeshPrefixCollisionsPanel.tsx
 *
 * The "Prefix Collisions" view of the Mesh Health page. Lists local contacts
 * that share the same public-key prefix at 1-, 2-, and 3-byte widths. A hop hash
 * in an advert path is a prefix of a node's public key, so a shared prefix makes
 * that hop ambiguous to resolve. Contacts-only and point-in-time, so this panel
 * ignores the page time-window (the shell hides the selector on this tab).
 *
 * Layout mirrors the ON8AR/CoreScope analyzer's collision view: a 16x16 first-
 * byte usage matrix (each cell coloured by the worst collision within it at the
 * selected width), summary tiles, and a collapsible list of colliding prefixes.
 * Clicking a matrix cell filters the list to that first byte; clicking a node
 * opens its detail page.
 *
 * Rendered inside the MeshHealthView shell; returns only its content blocks.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';
import { StatTile } from './meshHealthShared';

// ─── Types (mirror the backend PrefixCollisions* models) ──────────────────────

interface PrefixCollisionNode {
  name: string | null;
  public_key: string;
  lat: number | null;
  lon: number | null;
}
interface PrefixCollisionGroup {
  prefix: string;
  count: number;
  max_distance_km: number | null;
  located_count: number;
  assessment: 'local' | 'regional' | 'unknown';
  nodes: PrefixCollisionNode[];
}
interface PrefixCollisionWidth {
  width: number;
  total_nodes: number;
  distinct_prefixes: number;
  colliding_prefixes: number;
  colliding_nodes: number;
  matrix: number[]; // 256 entries: worst width-byte collision per first byte
  groups: PrefixCollisionGroup[];
}
interface PrefixCollisionsResponse {
  widths: PrefixCollisionWidth[];
}

interface Props {
  /** Incremented by the shell's refresh button to force a re-fetch. */
  refreshKey: number;
  /** Reports loading state up to the shell so the refresh spinner can reflect it. */
  onLoadingChange?: (loading: boolean) => void;
  /** Opens a node's detail page (contact conversation) by public key. */
  onOpenNode?: (publicKey: string, name: string | null) => void;
}

const WIDTH_OPTIONS: { width: number; labelKey: string }[] = [
  { width: 1, labelKey: 'mesh_health_pc_width_1b' },
  { width: 2, labelKey: 'mesh_health_pc_width_2b' },
  { width: 3, labelKey: 'mesh_health_pc_width_3b' },
];

const HEX = '0123456789ABCDEF';

// Cell colour by severity (worst collision count within the first-byte cell):
// 0 = available, 1 = one node, 2 = possible conflict, 3+ = collision.
function cellStyle(sev: number): CSSProperties {
  if (sev >= 3)
    return {
      backgroundColor: 'hsl(var(--destructive) / 0.85)',
      color: 'hsl(var(--destructive-foreground))',
    };
  if (sev === 2)
    return { backgroundColor: 'hsl(var(--warning) / 0.85)', color: 'hsl(var(--background))' };
  if (sev === 1)
    return { backgroundColor: 'hsl(var(--success) / 0.35)', color: 'hsl(var(--foreground))' };
  return { backgroundColor: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground) / 0.6)' };
}

function AssessmentPill({ group }: { group: PrefixCollisionGroup }) {
  const t = useT();
  if (group.assessment === 'unknown' || group.max_distance_km === null) return null;
  const local = group.assessment === 'local';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        local ? 'bg-warning/20 text-warning' : 'bg-muted text-muted-foreground'
      }`}
      title={t('mesh_health_pc_distance_km', { km: group.max_distance_km })}
    >
      {local ? t('mesh_health_pc_assess_local') : t('mesh_health_pc_assess_regional')} ·{' '}
      {t('mesh_health_pc_distance_km', { km: group.max_distance_km })}
    </span>
  );
}

function LegendSwatch({ sev, label }: { sev: number; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm border border-border"
        style={cellStyle(sev)}
      />
      {label}
    </span>
  );
}

export function MeshPrefixCollisionsPanel({ refreshKey, onLoadingChange, onOpenNode }: Props) {
  const t = useT();
  const [data, setData] = useState<PrefixCollisionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWidth, setSelectedWidth] = useState(1);
  // Collapsed by default: with dozens of colliding prefixes, showing every node
  // table at once is an unusable wall of text. Each group expands on click.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // A clicked matrix cell filters the group list to that first byte (0..255).
  const [selectedByte, setSelectedByte] = useState<number | null>(null);
  // Prefixes that have a soft resolution (a partial node linked to a full pubkey).
  const [resolvedPrefixes, setResolvedPrefixes] = useState<Set<string>>(new Set());

  const toggleGroup = (prefix: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });

  const changeWidth = (width: number) => {
    setSelectedWidth(width);
    setSelectedByte(null);
    setExpanded(new Set());
  };

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/packets/prefix-collisions')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PrefixCollisionsResponse>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('mesh_health_error_failed_to_load'));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, t]);

  useEffect(() => {
    let cancelled = false;
    api
      .listPartialResolutions()
      .then((rows) => {
        if (!cancelled) setResolvedPrefixes(new Set(rows.map((r) => r.prefix_hex)));
      })
      .catch(() => {
        if (!cancelled) setResolvedPrefixes(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const active = useMemo(
    () => data?.widths.find((w) => w.width === selectedWidth) ?? null,
    [data, selectedWidth]
  );

  const space = 256 ** selectedWidth;
  const spacePct = active
    ? ((active.distinct_prefixes / space) * 100).toFixed(space > 256 ? 3 : 1)
    : '0';

  const visibleGroups = useMemo(() => {
    if (!active) return [];
    if (selectedByte === null) return active.groups;
    return active.groups.filter((g) => parseInt(g.prefix.slice(0, 2), 16) === selectedByte);
  }, [active, selectedByte]);

  const byteHex = (b: number) => b.toString(16).padStart(2, '0');

  return (
    <>
      <p className="text-xs text-muted-foreground">{t('mesh_health_pc_caption')}</p>

      {/* Width sub-selector pill */}
      <div className="flex w-fit gap-1 rounded-md bg-muted p-0.5">
        {WIDTH_OPTIONS.map((opt) => (
          <button
            key={opt.width}
            onClick={() => changeWidth(opt.width)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              selectedWidth === opt.width
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(opt.labelKey)}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded border border-border bg-background"
            />
          ))}
        </div>
      )}

      {active && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile label={t('mesh_health_pc_stat_total')} value={active.total_nodes} />
          <StatTile
            label={t('mesh_health_pc_stat_space_used')}
            value={`${spacePct}%`}
            sub={`${active.distinct_prefixes} / ${space.toLocaleString()}`}
          />
          <StatTile
            label={t('mesh_health_pc_stat_colliding_prefixes')}
            value={active.colliding_prefixes}
          />
          <StatTile
            label={t('mesh_health_pc_stat_colliding_nodes')}
            value={active.colliding_nodes}
          />
        </div>
      )}

      {/* First-byte usage matrix */}
      {active && (
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('mesh_health_pc_matrix_heading')}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <LegendSwatch sev={0} label={t('mesh_health_pc_legend_available')} />
              <LegendSwatch sev={1} label={t('mesh_health_pc_legend_one')} />
              <LegendSwatch sev={2} label={t('mesh_health_pc_legend_possible')} />
              <LegendSwatch sev={3} label={t('mesh_health_pc_legend_collision')} />
            </div>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            {t('mesh_health_pc_matrix_note')}
          </p>
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}
          >
            {active.matrix.map((sev, b) => {
              const selected = selectedByte === b;
              return (
                <button
                  key={b}
                  onClick={() => setSelectedByte(selected ? null : b)}
                  title={`${byteHex(b).toUpperCase()}: ${sev} ${t('mesh_health_pc_col_nodes')}`}
                  aria-label={`${byteHex(b).toUpperCase()}: ${sev}`}
                  className={`flex aspect-square items-center justify-center rounded-[2px] font-mono text-[8px] leading-none transition-shadow ${
                    selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-card' : ''
                  }`}
                  style={cellStyle(sev)}
                >
                  {HEX[Math.floor(b / 16)]}
                  {HEX[b % 16]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Active first-byte filter chip */}
      {active && selectedByte !== null && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {t('mesh_health_pc_filter_label', { prefix: byteHex(selectedByte).toUpperCase() })}
          </span>
          <button
            onClick={() => setSelectedByte(null)}
            className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            {t('mesh_health_pc_clear_filter')}
          </button>
        </div>
      )}

      {active && visibleGroups.length > 0 && (
        <div className="space-y-1.5">
          {visibleGroups.map((g) => {
            const open = expanded.has(g.prefix);
            return (
              <div
                key={g.prefix}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(g.prefix)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-background"
                >
                  <span className="flex items-center gap-2">
                    <ChevronRight
                      className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                        open ? 'rotate-90' : ''
                      }`}
                    />
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {g.prefix}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {resolvedPrefixes.has(g.prefix) && (
                      <span
                        className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                        title={t('partial_sync_collision_badge_title')}
                      >
                        {t('partial_sync_collision_badge')}
                      </span>
                    )}
                    <AssessmentPill group={g} />
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {g.count} {t('mesh_health_pc_col_nodes')}
                    </span>
                  </span>
                </button>
                {open && (
                  <table className="w-full border-t border-border text-xs">
                    <tbody>
                      {g.nodes.map((n) => (
                        <tr
                          key={n.public_key}
                          className="border-b border-border transition-colors last:border-0 hover:bg-background"
                        >
                          <td className="px-3 py-1.5">
                            {onOpenNode ? (
                              <button
                                onClick={() => onOpenNode(n.public_key, n.name)}
                                className="text-left text-primary hover:underline"
                              >
                                {n.name ?? `${n.public_key.slice(0, 6)}…`}
                              </button>
                            ) : (
                              <span className="text-foreground">{n.name ?? '—'}</span>
                            )}
                            {n.lat !== null && n.lon !== null && (
                              <span className="ml-2 text-[10px] tabular-nums text-muted-foreground">
                                ({n.lat.toFixed(2)}, {n.lon.toFixed(2)})
                              </span>
                            )}
                          </td>
                          <td className="break-all px-3 py-1.5 text-right font-mono text-[10px] text-muted-foreground">
                            {n.public_key}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {active && visibleGroups.length === 0 && !loading && (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {selectedByte !== null
            ? t('mesh_health_pc_empty_cell', { prefix: byteHex(selectedByte).toUpperCase() })
            : t('mesh_health_pc_empty')}
        </div>
      )}
    </>
  );
}
