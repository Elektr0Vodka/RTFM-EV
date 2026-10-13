/**
 * Fleet asset page > Vault: the encrypted secrets of one asset (private key,
 * passwords) and, for an asset without a public key, key generation.
 *
 * Renders nothing unless the server runs with the vault switched on. A value
 * is only fetched when "Reveal" is pressed, and each reveal is written to the
 * vault's audit log on the server.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type { FleetAsset, FleetSecret, FleetSecretKind } from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { FleetVaultGate, useFleetVaultStatus, vaultCall, vaultErrorMessage } from './FleetVault';

const KINDS: FleetSecretKind[] = [
  'private_key',
  'admin_password',
  'guest_password',
  'wifi',
  'other',
];

function SecretList({
  asset,
  onAssetChanged,
}: {
  asset: FleetAsset;
  onAssetChanged: (asset: FleetAsset) => void;
}) {
  const t = useT();
  const [secrets, setSecrets] = useState<FleetSecret[] | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<number | null>(null);
  const [kind, setKind] = useState<FleetSecretKind>('admin_password');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [prefix, setPrefix] = useState('');
  const [freeBytes, setFreeBytes] = useState<0 | 1 | 2>(2);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setSecrets(await vaultCall(() => api.fleetSecrets(asset.id, signal)));
      } catch (err) {
        if (!isAbortError(err)) setError(vaultErrorMessage(err));
      }
    },
    [asset.id]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(vaultErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      await vaultCall(() => api.addFleetSecret(asset.id, kind, label.trim() || null, value));
      setLabel('');
      setValue('');
      await load();
    });

  const toggleReveal = (secretId: number) => {
    if (secretId in revealed) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[secretId];
        return next;
      });
      return;
    }
    void run(async () => {
      const result = await vaultCall(() => api.revealFleetSecret(secretId));
      setRevealed((prev) => ({ ...prev, [secretId]: result.value }));
    });
  };

  // Two clicks: a deleted secret cannot be brought back.
  const remove = (secretId: number) => {
    if (armedDelete !== secretId) {
      setArmedDelete(secretId);
      return;
    }
    setArmedDelete(null);
    void run(async () => {
      await vaultCall(() => api.deleteFleetSecret(secretId));
      await load();
    });
  };

  const generate = () =>
    run(async () => {
      const result = await vaultCall(() =>
        api.generateFleetKey(asset.id, prefix.trim(), freeBytes)
      );
      onAssetChanged(result.asset);
      await load();
    });

  return (
    <div className="space-y-3">
      {secrets !== null && secrets.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('fleet_vault_empty')}</p>
      )}
      {secrets !== null && secrets.length > 0 && (
        <ul className="divide-y divide-border text-xs">
          {secrets.map((secret) => (
            <li
              key={secret.id}
              data-testid={`fleet-secret-${secret.id}`}
              className="space-y-1 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">
                  {t(`fleet_secret_kind_${secret.kind}`)}
                </span>
                {secret.label && <span className="text-muted-foreground">{secret.label}</span>}
                <span className="text-muted-foreground">
                  {formatDateTime(secret.created_at * 1000, { dateStyle: 'medium' })}
                </span>
                <button
                  type="button"
                  data-testid={`fleet-secret-reveal-${secret.id}`}
                  disabled={busy}
                  onClick={() => toggleReveal(secret.id)}
                  className="ml-auto text-primary hover:underline"
                >
                  {secret.id in revealed ? t('fleet_vault_hide') : t('fleet_vault_reveal')}
                </button>
                <button
                  type="button"
                  data-testid={`fleet-secret-delete-${secret.id}`}
                  disabled={busy}
                  onClick={() => remove(secret.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  {armedDelete === secret.id ? t('fleet_delete_confirm') : t('common_delete')}
                </button>
              </div>
              {secret.id in revealed && (
                <code
                  data-testid={`fleet-secret-value-${secret.id}`}
                  className="block select-all break-all rounded bg-background px-2 py-1 font-mono text-[11px]"
                >
                  {revealed[secret.id]}
                </code>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_1fr_auto]">
        <select
          data-testid="fleet-secret-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as FleetSecretKind)}
          aria-label={t('fleet_vault_kind')}
          className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground"
        >
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {t(`fleet_secret_kind_${option}`)}
            </option>
          ))}
        </select>
        <Input
          data-testid="fleet-secret-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={200}
          placeholder={t('fleet_field_label')}
          aria-label={t('fleet_field_label')}
          className="h-9 text-xs"
        />
        <Input
          type="password"
          data-testid="fleet-secret-value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={4096}
          autoComplete="off"
          placeholder={t('fleet_vault_value')}
          aria-label={t('fleet_vault_value')}
          className="h-9 font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="fleet-secret-add"
          disabled={busy || value.trim() === ''}
          onClick={() => void add()}
        >
          {t('fleet_vault_add')}
        </Button>
      </div>

      {!asset.public_key && (
        <div className="space-y-2 border-t border-border pt-3" data-testid="fleet-keygen">
          <p className="text-xs font-medium text-foreground">{t('fleet_keygen_title')}</p>
          <p className="text-xs text-muted-foreground">{t('fleet_keygen_intro')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              data-testid="fleet-keygen-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              maxLength={4}
              placeholder={t('fleet_keygen_prefix')}
              aria-label={t('fleet_keygen_prefix')}
              className="h-9 w-40 font-mono text-xs"
            />
            <select
              data-testid="fleet-keygen-free"
              value={freeBytes}
              onChange={(e) => setFreeBytes(Number(e.target.value) as 0 | 1 | 2)}
              aria-label={t('fleet_keygen_free')}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              <option value={2}>{t('fleet_keygen_free_2')}</option>
              <option value={1}>{t('fleet_keygen_free_1')}</option>
              <option value={0}>{t('fleet_keygen_free_0')}</option>
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="fleet-keygen-run"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? t('fleet_vault_working') : t('fleet_keygen_run')}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function FleetAssetSecrets({
  asset,
  onAssetChanged,
}: {
  asset: FleetAsset;
  /** Called with the asset after key generation gave it a public key. */
  onAssetChanged: (asset: FleetAsset) => void;
}) {
  const t = useT();
  const { status, reload } = useFleetVaultStatus();

  if (!status?.enabled) return null;

  return (
    <div
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      data-testid="fleet-secrets"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('fleet_vault_title')}
      </p>
      <FleetVaultGate status={status} onChanged={reload}>
        <SecretList asset={asset} onAssetChanged={onAssetChanged} />
      </FleetVaultGate>
    </div>
  );
}
