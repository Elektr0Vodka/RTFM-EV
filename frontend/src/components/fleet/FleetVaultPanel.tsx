/**
 * Fleet page > Key vault: lock, change the passphrase, export and import the
 * encrypted secrets, and read the audit log.
 *
 * Renders nothing unless the server runs with the vault switched on. The
 * export file is encrypted under a passphrase typed for that export, not the
 * vault's own.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type { FleetAuditEntry } from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { setFleetVaultToken } from '../../utils/fleetVault';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { FleetVaultGate, useFleetVaultStatus, vaultCall, vaultErrorMessage } from './FleetVault';
import { downloadFleetFile, fleetExportFilename } from './fleetShared';

const NO_VALUE = '-';
const PASSPHRASE_MIN = 12;

function VaultTools({ onOpenAsset }: { onOpenAsset: (assetId: number) => void }) {
  const t = useT();
  const [audit, setAudit] = useState<FleetAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const loadAudit = useCallback(async (signal?: AbortSignal) => {
    try {
      setAudit(await vaultCall(() => api.fleetVaultAudit(signal)));
    } catch (err) {
      if (!isAbortError(err)) setError(vaultErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAudit(controller.signal);
    return () => controller.abort();
  }, [loadAudit]);

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await action());
    } catch (err) {
      setError(vaultErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const lock = () =>
    run(async () => {
      await api.lockFleetVault();
      setFleetVaultToken(null);
      return null;
    });

  const changePassphrase = () =>
    run(async () => {
      const session = await vaultCall(() => api.changeFleetVaultPassphrase(current, next));
      setFleetVaultToken(session.token);
      setCurrent('');
      setNext('');
      await loadAudit();
      return t('fleet_vault_passphrase_changed');
    });

  const exportVault = () =>
    run(async () => {
      const document = await vaultCall(() => api.exportFleetVault(exportPassphrase));
      downloadFleetFile(
        fleetExportFilename('json', new Date()).replace('fleet_', 'fleet-vault_'),
        'application/json',
        [JSON.stringify(document, null, 2)]
      );
      setExportPassphrase('');
      await loadAudit();
      return t('fleet_vault_exported');
    });

  const importVault = () =>
    run(async () => {
      const file = fileInput.current?.files?.[0];
      if (!file) return null;
      let document: unknown;
      try {
        document = JSON.parse(await file.text());
      } catch {
        throw new Error(t('fleet_vault_import_not_json'));
      }
      const result = await vaultCall(() => api.importFleetVault(importPassphrase, document));
      setImportPassphrase('');
      if (fileInput.current) fileInput.current.value = '';
      await loadAudit();
      return t('fleet_vault_imported', { imported: result.imported, skipped: result.skipped });
    });

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-success">{t('fleet_vault_unlocked')}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="fleet-vault-lock"
          disabled={busy}
          onClick={() => void lock()}
        >
          {t('fleet_vault_lock')}
        </Button>
      </div>

      <div className="space-y-1">
        <p className="font-medium text-foreground">{t('fleet_vault_change_title')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            placeholder={t('fleet_vault_current')}
            aria-label={t('fleet_vault_current')}
            className="h-9 max-w-xs text-xs"
          />
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            placeholder={t('fleet_vault_new')}
            aria-label={t('fleet_vault_new')}
            className="h-9 max-w-xs text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || current === '' || next.length < PASSPHRASE_MIN}
            onClick={() => void changePassphrase()}
          >
            {t('fleet_vault_change')}
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <p className="font-medium text-foreground">{t('fleet_vault_export_title')}</p>
        <p className="text-muted-foreground">{t('fleet_vault_export_hint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            data-testid="fleet-vault-export-passphrase"
            value={exportPassphrase}
            onChange={(e) => setExportPassphrase(e.target.value)}
            autoComplete="new-password"
            placeholder={t('fleet_vault_export_passphrase')}
            aria-label={t('fleet_vault_export_passphrase')}
            className="h-9 max-w-xs text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="fleet-vault-export"
            disabled={busy || exportPassphrase.length < PASSPHRASE_MIN}
            onClick={() => void exportVault()}
          >
            {t('fleet_vault_export')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            aria-label={t('fleet_vault_import_file')}
            className="max-w-xs text-xs text-muted-foreground"
          />
          <Input
            type="password"
            value={importPassphrase}
            onChange={(e) => setImportPassphrase(e.target.value)}
            autoComplete="off"
            placeholder={t('fleet_vault_export_passphrase')}
            aria-label={t('fleet_vault_export_passphrase')}
            className="h-9 max-w-xs text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || importPassphrase === ''}
            onClick={() => void importVault()}
          >
            {t('fleet_vault_import')}
          </Button>
        </div>
      </div>

      {note && (
        <p className="text-success" data-testid="fleet-vault-note">
          {note}
        </p>
      )}
      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground">{t('fleet_vault_audit_title')}</p>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => void loadAudit()}
          >
            {t('fleet_refresh')}
          </button>
        </div>
        {audit !== null && audit.length === 0 && (
          <p className="text-muted-foreground">{t('fleet_vault_audit_empty')}</p>
        )}
        {audit !== null && audit.length > 0 && (
          <div className="max-h-64 overflow-auto rounded border border-border">
            <table className="w-full text-[11px]" data-testid="fleet-vault-audit">
              <tbody>
                {audit.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">
                      {formatDateTime(row.ts * 1000, { dateStyle: 'short', timeStyle: 'medium' })}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-mono">{row.action}</td>
                    <td className="px-2 py-1">
                      {row.asset_id !== null ? (
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => onOpenAsset(row.asset_id as number)}
                        >
                          {t('fleet_vault_audit_asset', { id: row.asset_id })}
                        </button>
                      ) : (
                        NO_VALUE
                      )}
                    </td>
                    <td className="px-2 py-1">{row.detail ?? NO_VALUE}</td>
                    <td className="whitespace-nowrap px-2 py-1 font-mono text-muted-foreground">
                      {[row.auth_user, row.remote_addr].filter(Boolean).join(' @ ') || NO_VALUE}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function FleetVaultPanel({ onOpenAsset }: { onOpenAsset: (assetId: number) => void }) {
  const t = useT();
  const { status, reload } = useFleetVaultStatus();

  if (!status?.enabled) return null;

  return (
    <details
      className="rounded-lg border border-border bg-card px-4 py-3"
      data-testid="fleet-vault-panel"
    >
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        {t('fleet_vault_title')}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">{t('fleet_vault_intro')}</p>
        <FleetVaultGate status={status} onChanged={reload}>
          <VaultTools onOpenAsset={onOpenAsset} />
        </FleetVaultGate>
      </div>
    </details>
  );
}
