import { lazy, Suspense, useMemo } from 'react';

import type { SpamGuardController } from '../../hooks/useSpamGuard';
import { useT } from '../../i18n';
import { CONTACT_TYPE_REPEATER } from '../../types';
import type { Contact, SpamGuardState } from '../../types';
import { Button } from '../ui/button';
import type { SpamSourcePoint } from './SpamSourcesMap';
import { formatDuration } from './spamGuardText';

const SpamSourcesMap = lazy(() =>
  import('./SpamSourcesMap').then((m) => ({ default: m.SpamSourcesMap }))
);

const DIRECT = 'DIRECT';
const MAX_CANDIDATES = 6;

function hasLocation(contact: Contact): contact is Contact & { lat: number; lon: number } {
  return (
    typeof contact.lat === 'number' &&
    typeof contact.lon === 'number' &&
    (contact.lat !== 0 || contact.lon !== 0)
  );
}

/**
 * Which repeaters spam enters the mesh through. A route only carries the first
 * bytes of a repeater's key, and a short code is shared by several repeaters,
 * so every repeater that fits is listed as a candidate; nothing is guessed.
 */
export function SpamSourcesTab({
  state,
  guard,
  contacts,
}: {
  state: SpamGuardState;
  guard: SpamGuardController;
  contacts: Contact[];
}) {
  const t = useT();
  const now = Date.now() / 1000;
  const disabled = guard.busy || !state.enabled;
  const repeaters = useMemo(
    () => contacts.filter((c) => c.type === CONTACT_TYPE_REPEATER),
    [contacts]
  );
  const rows = useMemo(
    () =>
      state.metrics.sources.map((source) => {
        const prefix = source.hop.toLowerCase();
        const candidates =
          source.hop === DIRECT
            ? []
            : repeaters
                .filter((c) => c.public_key.toLowerCase().startsWith(prefix))
                .slice(0, MAX_CANDIDATES);
        return { source, candidates };
      }),
    [state.metrics.sources, repeaters]
  );
  const points = useMemo(() => {
    const seen = new Set<string>();
    const out: SpamSourcePoint[] = [];
    for (const { source, candidates } of rows) {
      for (const contact of candidates) {
        if (!hasLocation(contact) || seen.has(contact.public_key)) continue;
        seen.add(contact.public_key);
        out.push({
          key: contact.public_key,
          lat: contact.lat,
          lon: contact.lon,
          label: `${contact.name ?? contact.public_key.slice(0, 12)} (${source.hop})`,
          blocked: source.blocked,
        });
      }
    }
    return out;
  }, [rows]);

  if (rows.length === 0) {
    return <p className="text-[0.8125rem] text-muted-foreground">{t('spam_sources_empty')}</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-[0.8125rem] text-muted-foreground">{t('spam_sources_desc')}</p>
      {points.length > 0 && (
        <Suspense fallback={<div className="h-72 rounded-md border border-border/60" />}>
          <SpamSourcesMap points={points} ariaLabel={t('spam_sources_map_label')} />
        </Suspense>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[0.8125rem]">
          <thead className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-1 font-medium">{t('spam_sources_col_hop')}</th>
              <th className="px-2 py-1 font-medium">{t('spam_sources_col_candidates')}</th>
              <th className="px-2 py-1 font-medium">{t('spam_sources_col_d1')}</th>
              <th className="px-2 py-1 font-medium">{t('spam_sources_col_d7')}</th>
              <th className="px-2 py-1 font-medium">{t('spam_sources_col_last')}</th>
              <th className="px-2 py-1 font-medium">
                <span className="sr-only">{t('spam_sources_col_actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ source, candidates }) => (
              <tr key={source.hop} className="border-t border-border/60" data-testid="spam-source">
                <td className="px-2 py-1.5 font-mono text-foreground">
                  {source.hop === DIRECT ? t('spam_path_direct') : source.hop}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {candidates.length === 0
                    ? t('spam_sources_unknown')
                    : candidates.map((c) => c.name ?? c.public_key.slice(0, 12)).join(', ')}
                </td>
                <td className="px-2 py-1.5">{source.d1}</td>
                <td className="px-2 py-1.5">{source.d7}</td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {formatDuration(now - source.last, t)}
                </td>
                <td className="px-2 py-1.5">
                  {source.hop !== DIRECT && (
                    <div className="flex flex-wrap gap-1">
                      {source.blocked ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => void guard.action('unblock', { key: `hop:${source.hop}` })}
                        >
                          {t('spam_sources_unblock')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => void guard.action('block_hop', { hop: source.hop })}
                        >
                          {t('spam_sources_block')}
                        </Button>
                      )}
                      {source.allowed ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => void guard.action('unallow_hop', { hop: source.hop })}
                        >
                          {t('spam_sources_unallow')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => void guard.action('allow_hop', { hop: source.hop })}
                        >
                          {t('spam_sources_allow')}
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
