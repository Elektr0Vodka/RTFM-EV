/**
 * Tools > Network scan: find MeshCore devices on the local network.
 *
 * The server does the checking (`/api/lan-discovery`): an SNMP GET per address
 * and, only when ticked, a companion protocol handshake on the app port. All
 * of it is LAN traffic; nothing goes over the radio. The app port check is
 * off by default because a stock MeshCore WiFi companion drops the app that
 * is connected to it when a new connection arrives. The web config check (also
 * off by default) is one HTTP GET of a DMC observer's status page.
 *
 * A found device that matches a contact can be opened, and an SNMP agent can
 * be set up on that contact in one click (the same settings the contact's SNMP
 * card writes).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Search, Square } from 'lucide-react';
import { api, isAbortError } from '../api';
import { useT, type TFn } from '../i18n';
import { cn } from '@/lib/utils';
import type { LanScanHost, LanScanStatus, LanScanSuggestions } from '../types';
import { contactTypeLabel } from './ContactInfoBody';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Label } from './ui/label';

const POLL_MS = 1000;
// Contact types that can carry SNMP settings (same list as the server's).
const SNMP_CONTACT_TYPES = new Set([1, 2, 3]);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hostName(host: LanScanHost): string | null {
  return (
    host.companion?.name ||
    host.webconfig?.name ||
    host.snmp?.node_name ||
    host.contact?.name ||
    host.snmp?.sys_name ||
    null
  );
}

function hostRole(host: LanScanHost, t: TFn): string | null {
  const type = host.companion?.adv_type ?? host.webconfig?.adv_type ?? host.contact?.type ?? null;
  return type ? contactTypeLabel(type, t) : null;
}

/** MeshCore devices first; other SNMP agents and bare open ports only when asked. */
export function isMeshcoreHost(host: LanScanHost): boolean {
  return (
    host.snmp?.kind === 'meshcore' || host.companion?.found === true || host.webconfig !== null
  );
}

/**
 * Whether this host's SNMP agent can be set up on its contact:
 * 'no-agent' (no MeshCore SNMP answer), 'unavailable' (no contact that can
 * carry SNMP settings), 'new', 'set' (this address already), or 'elsewhere'
 * (the contact polls another address).
 */
export function snmpSetupState(
  host: LanScanHost,
  snmpPort: number
): 'no-agent' | 'unavailable' | 'new' | 'set' | 'elsewhere' {
  if (host.snmp?.kind !== 'meshcore') return 'no-agent';
  const contact = host.contact;
  if (!contact || contact.type === null || !SNMP_CONTACT_TYPES.has(contact.type)) {
    return 'unavailable';
  }
  if (!contact.snmp_host) return 'new';
  return contact.snmp_host === host.ip && contact.snmp_port === snmpPort ? 'set' : 'elsewhere';
}

export function LanScanView({
  onOpenContactInfo,
}: {
  onOpenContactInfo: (publicKey: string) => void;
}) {
  const t = useT();
  const [targets, setTargets] = useState('');
  const [snmp, setSnmp] = useState(true);
  const [snmpPort, setSnmpPort] = useState('161');
  const [community, setCommunity] = useState('');
  const [companion, setCompanion] = useState(false);
  const [companionPort, setCompanionPort] = useState('5000');
  const [webconfig, setWebconfig] = useState(false);
  const [webconfigPort, setWebconfigPort] = useState('80');
  const [showOther, setShowOther] = useState(false);
  const [suggestions, setSuggestions] = useState<LanScanSuggestions | null>(null);
  const [status, setStatus] = useState<LanScanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const mounted = useRef(true);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await api.lanScanStatus(signal);
      if (mounted.current) setStatus(next);
    } catch (err) {
      if (!isAbortError(err) && mounted.current) setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void refresh(controller.signal);
    api.lanScanSuggestions(controller.signal).then(
      (result) => {
        setSuggestions(result);
        // Prefill with the first suggestion; the field stays the user's after that.
        setTargets((current) => current || result.networks[0] || '');
      },
      () => {}
    );
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [refresh]);

  const running = status?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, refresh]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const next = await api.startLanScan({
        targets,
        snmp,
        snmp_port: Number(snmpPort) || 161,
        community: community.trim() || null,
        companion,
        companion_port: Number(companionPort) || 5000,
        webconfig,
        webconfig_port: Number(webconfigPort) || 80,
      });
      setStatus(next);
      setSaveErrors({});
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    try {
      setStatus(await api.cancelLanScan());
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const setUpSnmp = async (host: LanScanHost) => {
    if (!host.contact || !status) return;
    setSaving(host.ip);
    setSaveErrors((prev) => {
      const next = { ...prev };
      delete next[host.ip];
      return next;
    });
    try {
      await api.saveSnmpConfig(host.contact.public_key, {
        host: host.ip,
        port: status.snmp_port,
        // Empty keeps a stored community (or 'public' for a new setup).
        community: community.trim() || null,
        poll_enabled: false,
        poll_interval_minutes: 5,
      });
      await refresh();
    } catch (err) {
      setSaveErrors((prev) => ({ ...prev, [host.ip]: errorMessage(err) }));
    } finally {
      setSaving(null);
    }
  };

  const hosts = useMemo(
    () => (status?.hosts ?? []).filter((host) => showOther || isMeshcoreHost(host)),
    [status, showOther]
  );
  const meshcoreCount = (status?.hosts ?? []).filter(isMeshcoreHost).length;
  const otherCount = (status?.hosts.length ?? 0) - meshcoreCount;
  const canStart =
    !running && !starting && targets.trim() !== '' && (snmp || companion || webconfig);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-base font-semibold text-foreground">{t('nav_lan_scan')}</h2>
        <p className="text-xs text-muted-foreground">{t('lan_scan_intro')}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <form
          className="space-y-3 rounded-lg border border-border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canStart) void start();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="lan-scan-targets">{t('lan_scan_targets_label')}</Label>
            <Input
              id="lan-scan-targets"
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
              placeholder="192.168.1.0/24"
              disabled={running}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">{t('lan_scan_targets_help')}</p>
            {suggestions && suggestions.networks.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">{t('lan_scan_suggestions')}</span>
                {suggestions.networks.map((network) => (
                  <button
                    key={network}
                    type="button"
                    disabled={running}
                    onClick={() => setTargets(network)}
                    className="rounded border border-border px-1.5 py-0.5 font-mono hover:bg-accent disabled:opacity-50"
                  >
                    {network}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="lan-scan-snmp"
                  checked={snmp}
                  disabled={running}
                  onCheckedChange={(value) => setSnmp(value === true)}
                />
                <Label htmlFor="lan-scan-snmp">{t('lan_scan_snmp_label')}</Label>
              </div>
              {snmp && (
                <>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="lan-scan-snmp-port" className="text-xs text-muted-foreground">
                      {t('lan_scan_port')}
                    </Label>
                    <Input
                      id="lan-scan-snmp-port"
                      inputMode="numeric"
                      value={snmpPort}
                      onChange={(e) => setSnmpPort(e.target.value.replace(/\D/g, ''))}
                      disabled={running}
                      className="h-8 w-20 font-mono"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="lan-scan-community" className="text-xs text-muted-foreground">
                      {t('lan_scan_community')}
                    </Label>
                    <Input
                      id="lan-scan-community"
                      type="password"
                      autoComplete="off"
                      value={community}
                      onChange={(e) => setCommunity(e.target.value)}
                      placeholder="public"
                      disabled={running}
                      className="h-8 w-36"
                    />
                  </div>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('lan_scan_snmp_help')}</p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="lan-scan-companion"
                  checked={companion}
                  disabled={running}
                  onCheckedChange={(value) => setCompanion(value === true)}
                />
                <Label htmlFor="lan-scan-companion">{t('lan_scan_companion_label')}</Label>
              </div>
              {companion && (
                <div className="flex items-center gap-1.5">
                  <Label
                    htmlFor="lan-scan-companion-port"
                    className="text-xs text-muted-foreground"
                  >
                    {t('lan_scan_port')}
                  </Label>
                  <Input
                    id="lan-scan-companion-port"
                    inputMode="numeric"
                    value={companionPort}
                    onChange={(e) => setCompanionPort(e.target.value.replace(/\D/g, ''))}
                    disabled={running}
                    className="h-8 w-20 font-mono"
                  />
                </div>
              )}
            </div>
            <p
              className={cn(
                'flex gap-1.5 text-xs',
                companion ? 'text-warning' : 'text-muted-foreground'
              )}
              data-testid="lan-scan-companion-warning"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{t('lan_scan_companion_warning')}</span>
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="lan-scan-webconfig"
                  checked={webconfig}
                  disabled={running}
                  onCheckedChange={(value) => setWebconfig(value === true)}
                />
                <Label htmlFor="lan-scan-webconfig">{t('lan_scan_webconfig_label')}</Label>
              </div>
              {webconfig && (
                <div className="flex items-center gap-1.5">
                  <Label
                    htmlFor="lan-scan-webconfig-port"
                    className="text-xs text-muted-foreground"
                  >
                    {t('lan_scan_port')}
                  </Label>
                  <Input
                    id="lan-scan-webconfig-port"
                    inputMode="numeric"
                    value={webconfigPort}
                    onChange={(e) => setWebconfigPort(e.target.value.replace(/\D/g, ''))}
                    disabled={running}
                    className="h-8 w-20 font-mono"
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('lan_scan_webconfig_help')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {running ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void stop()}>
                <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {t('lan_scan_stop')}
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!canStart}>
                <Search className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {starting ? t('lan_scan_starting') : t('lan_scan_start')}
              </Button>
            )}
            {status && (
              <span className="text-xs text-muted-foreground" role="status">
                {running
                  ? t('lan_scan_progress', {
                      done: status.done,
                      total: status.total,
                      found: meshcoreCount,
                    })
                  : status.cancelled
                    ? t('lan_scan_cancelled', {
                        done: status.done,
                        total: status.total,
                        found: meshcoreCount,
                      })
                    : t('lan_scan_finished', { total: status.total, found: meshcoreCount })}
              </span>
            )}
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {t('lan_scan_failed', { error })}
            </p>
          )}
          {status?.error && (
            <p className="text-sm text-destructive" role="alert">
              {t('lan_scan_failed', { error: status.error })}
            </p>
          )}
          {status && status.skipped.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('lan_scan_skipped', { addresses: status.skipped.join(', ') })}
            </p>
          )}
        </form>

        {status && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-sm font-semibold text-foreground">
                {t('lan_scan_results')}
              </h3>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="lan-scan-show-other"
                  checked={showOther}
                  onCheckedChange={(value) => setShowOther(value === true)}
                />
                <Label htmlFor="lan-scan-show-other" className="text-xs">
                  {t('lan_scan_show_other', { count: otherCount })}
                </Label>
              </div>
            </div>

            {hosts.length === 0 ? (
              <p
                className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
                data-testid="lan-scan-empty"
              >
                {running ? t('lan_scan_none_yet') : t('lan_scan_none')}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        {t('lan_scan_col_address')}
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        {t('lan_scan_col_device')}
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        {t('lan_scan_col_found_by')}
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        {t('lan_scan_col_firmware')}
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        {t('lan_scan_col_contact')}
                      </th>
                      <th scope="col" className="px-2 py-1.5">
                        <span className="sr-only">{t('lan_scan_col_actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {hosts.map((host) => (
                      <LanScanRow
                        key={host.ip}
                        host={host}
                        snmpPort={status.snmp_port}
                        companionPort={status.companion_port}
                        webconfigPort={status.webconfig_port}
                        saving={saving === host.ip}
                        saveError={saveErrors[host.ip] ?? null}
                        onOpenContact={onOpenContactInfo}
                        onSetUpSnmp={(target) => void setUpSnmp(target)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LanScanRow({
  host,
  snmpPort,
  companionPort,
  webconfigPort,
  saving,
  saveError,
  onOpenContact,
  onSetUpSnmp,
}: {
  host: LanScanHost;
  snmpPort: number;
  companionPort: number;
  webconfigPort: number;
  saving: boolean;
  saveError: string | null;
  onOpenContact: (publicKey: string) => void;
  onSetUpSnmp: (host: LanScanHost) => void;
}) {
  const t = useT();
  const name = hostName(host);
  const role = hostRole(host, t);
  const meshcore = isMeshcoreHost(host);
  const firmware =
    host.companion?.firmware_version ||
    host.webconfig?.firmware_version ||
    host.snmp?.firmware_version ||
    null;
  const model = host.companion?.model || host.webconfig?.board || null;
  const webconfigUrl = host.webconfig ? `http://${host.ip}:${webconfigPort}/` : null;
  const snmpState = snmpSetupState(host, snmpPort);
  const contact = host.contact;
  const foundBy: string[] = [];
  if (host.snmp) {
    foundBy.push(
      host.snmp.kind === 'meshcore'
        ? t('lan_scan_found_snmp', { port: snmpPort })
        : t('lan_scan_found_snmp_other', { port: snmpPort })
    );
  }
  if (host.companion) {
    foundBy.push(
      host.companion.found
        ? t('lan_scan_found_companion', { port: companionPort })
        : t('lan_scan_found_open_port', { port: companionPort })
    );
  }
  if (host.webconfig) {
    foundBy.push(
      host.webconfig.mode === 'setup'
        ? t('lan_scan_found_webconfig_setup', { port: webconfigPort })
        : t('lan_scan_found_webconfig', { port: webconfigPort })
    );
  }

  return (
    <tr
      className={cn('border-b border-border last:border-0', !meshcore && 'text-muted-foreground')}
      data-testid={`lan-scan-host-${host.ip}`}
    >
      <td className="whitespace-nowrap px-2 py-1.5 font-mono">{host.ip}</td>
      <td className="px-2 py-1.5">
        <span className={cn(meshcore && 'font-medium text-foreground')}>
          {name ?? t('lan_scan_unnamed')}
        </span>
        {role && <span className="ml-1.5 text-muted-foreground">{role}</span>}
        {!meshcore && host.snmp?.sys_descr && (
          <span className="block max-w-[22rem] truncate" title={host.snmp.sys_descr}>
            {host.snmp.sys_descr}
          </span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {foundBy.map((label) => (
          <span key={label} className="block whitespace-nowrap">
            {label}
          </span>
        ))}
      </td>
      <td className="px-2 py-1.5">
        {firmware && <span className="block font-mono">{firmware}</span>}
        {model && <span className="block text-muted-foreground">{model}</span>}
        {!firmware && !model && '-'}
      </td>
      <td className="px-2 py-1.5">
        {contact ? (
          <button
            type="button"
            onClick={() => onOpenContact(contact.public_key)}
            className="text-left text-primary hover:underline"
            title={
              contact.matched_by === 'name'
                ? t('lan_scan_matched_by_name')
                : contact.matched_by === 'node_id'
                  ? t('lan_scan_matched_by_node_id')
                  : t('lan_scan_matched_by_key')
            }
          >
            {contact.name || contact.public_key.slice(0, 12)}
          </button>
        ) : meshcore ? (
          <span className="text-muted-foreground">{t('lan_scan_no_contact')}</span>
        ) : (
          '-'
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right">
        {webconfigUrl && (
          <a
            href={webconfigUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mr-2 text-primary hover:underline"
          >
            {t('lan_scan_open_webconfig')}
          </a>
        )}
        {snmpState === 'set' && (
          <span className="text-muted-foreground">{t('lan_scan_snmp_set')}</span>
        )}
        {(snmpState === 'new' || snmpState === 'elsewhere') && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={saving}
            title={
              snmpState === 'elsewhere' && contact
                ? t('lan_scan_snmp_replace_title', {
                    address: `${contact.snmp_host}:${contact.snmp_port}`,
                  })
                : undefined
            }
            onClick={() => onSetUpSnmp(host)}
          >
            {saving
              ? t('lan_scan_snmp_saving')
              : snmpState === 'elsewhere' && contact
                ? t('lan_scan_snmp_replace')
                : t('lan_scan_snmp_setup')}
          </Button>
        )}
        {saveError && (
          <p className="mt-1 whitespace-normal text-destructive" role="alert">
            {saveError}
          </p>
        )}
      </td>
    </tr>
  );
}
