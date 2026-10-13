/**
 * Shared pieces of the fleet key vault UI: the status hook, the wrapper that
 * forgets the session when the server says it ended, and the gate that shows
 * the set-passphrase or unlock form until the vault is open.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type { FleetVaultStatus } from '../../types';
import { setFleetVaultToken, useFleetVaultUnlocked } from '../../utils/fleetVault';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const PASSPHRASE_MIN = 12;

export function vaultErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs a vault request; a 401 means the session ended, so the tab locks too. */
export async function vaultCall<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (err) {
    if ((err as { status?: unknown } | null)?.status === 401) setFleetVaultToken(null);
    throw err;
  }
}

/** The vault's state on the server, re-read whenever this tab locks or unlocks. */
export function useFleetVaultStatus(): {
  status: FleetVaultStatus | null;
  reload: () => void;
} {
  const hasToken = useFleetVaultUnlocked();
  const [status, setStatus] = useState<FleetVaultStatus | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api
      .fleetVaultStatus(controller.signal)
      .then((next) => {
        setStatus(next);
        // The server ended the session (idle or restart): drop the dead token.
        if (!next.unlocked && hasToken) setFleetVaultToken(null);
      })
      .catch((err) => {
        if (!isAbortError(err)) setStatus(null);
      });
    return () => controller.abort();
  }, [hasToken, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { status, reload };
}

/**
 * Shows `children` once the vault is unlocked in this tab. Before that it
 * shows the form to set the passphrase (first use) or to unlock.
 */
export function FleetVaultGate({
  status,
  onChanged,
  children,
}: {
  status: FleetVaultStatus;
  onChanged: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const unlocked = useFleetVaultUnlocked() && status.unlocked;
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (unlocked) return <>{children}</>;

  const firstUse = !status.initialised;
  const ready = firstUse
    ? passphrase.length >= PASSPHRASE_MIN && passphrase === repeat
    : passphrase.length > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = firstUse
        ? await api.initFleetVault(passphrase)
        : await api.unlockFleetVault(passphrase);
      setPassphrase('');
      setRepeat('');
      setFleetVaultToken(session.token);
      onChanged();
    } catch (err) {
      setError(vaultErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-2"
      data-testid="fleet-vault-gate"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void submit();
      }}
    >
      <p className="text-xs text-muted-foreground">
        {firstUse ? t('fleet_vault_first_use') : t('fleet_vault_locked')}
      </p>
      {firstUse && (
        <p className="text-xs font-medium text-warning">{t('fleet_vault_no_recovery')}</p>
      )}
      {!window.isSecureContext && (
        <p className="text-xs font-medium text-destructive" data-testid="fleet-vault-insecure">
          {t('fleet_vault_insecure')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          data-testid="fleet-vault-passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete={firstUse ? 'new-password' : 'current-password'}
          placeholder={t('fleet_vault_passphrase')}
          aria-label={t('fleet_vault_passphrase')}
          className="h-9 max-w-xs text-xs"
        />
        {firstUse && (
          <Input
            type="password"
            data-testid="fleet-vault-passphrase-repeat"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            placeholder={t('fleet_vault_passphrase_repeat')}
            aria-label={t('fleet_vault_passphrase_repeat')}
            className="h-9 max-w-xs text-xs"
          />
        )}
        <Button type="submit" size="sm" data-testid="fleet-vault-unlock" disabled={busy || !ready}>
          {busy
            ? t('fleet_vault_working')
            : firstUse
              ? t('fleet_vault_set_passphrase')
              : t('fleet_vault_unlock')}
        </Button>
      </div>
      {firstUse && (
        <p className="text-xs text-muted-foreground">
          {t('fleet_vault_passphrase_rule', { count: PASSPHRASE_MIN })}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
