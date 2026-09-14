import { useEffect, useState } from 'react';
import { api } from '../../../../api';
import type { OpenHopTransportKey, OpenHopNeighborScopes } from '../../../../types';
import { useT } from '../../../../i18n';

function asKeyList(
  data: OpenHopTransportKey[] | Record<string, OpenHopTransportKey> | undefined
): OpenHopTransportKey[] {
  if (!data) return [];
  return Array.isArray(data) ? data : Object.values(data);
}

/**
 * OpenHop transport keys + neighbor scopes. Lists/creates keys (delete is
 * confirm-gated), shows this node's served scopes and per-neighbour learned
 * scopes, and queries one neighbour's scopes on demand.
 */
export function OpenHopTransportPane() {
  const t = useT();
  const [keys, setKeys] = useState<OpenHopTransportKey[]>([]);
  const [scopes, setScopes] = useState<OpenHopNeighborScopes | null>(null);
  const [newName, setNewName] = useState('');
  const [pubkey, setPubkey] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [k, s] = await Promise.all([
        api.getOpenHopTransportKeys(),
        api.getOpenHopNeighborScopes(),
      ]);
      setKeys(asKeyList(k.data));
      setScopes(s);
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      await api.openHopCreateTransportKey(newName.trim());
      setNewName('');
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  const doDelete = async (keyId: string) => {
    setConfirmDelete(null);
    setError(null);
    try {
      await api.openHopDeleteTransportKey(keyId);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  const query = async () => {
    if (!pubkey.trim()) return;
    setError(null);
    try {
      await api.openHopQueryNeighborScopes(pubkey.trim());
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const scopeRows = scopes?.data ? Object.entries(scopes.data) : [];

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-md border border-border p-3 space-y-2">
        <div className="text-xs font-medium">{t('openhop_tk_title')}</div>
        {keys.length === 0 && <div className="text-xs text-muted-foreground">-</div>}
        {keys.map((k) => {
          const id = String(k.id ?? k.name ?? '');
          return (
            <div key={id} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono">{k.name ?? id}</span>
              {confirmDelete === id ? (
                <span className="flex gap-1">
                  <button
                    type="button"
                    className="rounded bg-destructive px-2 py-0.5 text-destructive-foreground"
                    onClick={() => void doDelete(id)}
                  >
                    {t('openhop_tk_delete')}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-0.5"
                    onClick={() => setConfirmDelete(null)}
                  >
                    {t('common_cancel')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="rounded border border-border px-2 py-0.5"
                  onClick={() => setConfirmDelete(id)}
                >
                  {t('openhop_tk_delete')}
                </button>
              )}
            </div>
          );
        })}
        <div className="flex gap-2 pt-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('openhop_tk_name')}
            className="w-40 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          />
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
            onClick={() => void create()}
          >
            {t('openhop_tk_create')}
          </button>
        </div>
      </div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <div className="text-xs font-medium">{t('openhop_scopes_title')}</div>
        <div className="text-xs text-muted-foreground">
          {t('openhop_scopes_served')}:{' '}
          <span className="font-mono">{scopes?.served?.scopes ?? '-'}</span>
        </div>
        {scopeRows.length > 0 && (
          <div className="space-y-0.5">
            {scopeRows.map(([pk, rec]) => (
              <div key={pk} className="flex justify-between gap-4 text-[11px]">
                <span className="font-mono">{pk.slice(0, 12)}…</span>
                <span className="font-mono">{rec.scopes || '(unscoped)'}</span>
                <span className="text-muted-foreground">{rec.status}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <input
            value={pubkey}
            onChange={(e) => setPubkey(e.target.value)}
            placeholder={t('openhop_scopes_pubkey')}
            className="w-72 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
          />
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-xs"
            onClick={() => void query()}
          >
            {t('openhop_scopes_query')}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
