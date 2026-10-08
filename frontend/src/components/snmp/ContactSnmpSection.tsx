import { useCallback, useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import { ApiError, api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import { formatDateTime } from '../../utils/dateTimeFormat';
import type { Contact, ContactSnmpConfig, SnmpPollResponse } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { SnmpHistoryChart } from './SnmpHistoryChart';
import { SNMP_FIELDS, SNMP_GROUPS, formatSnmpValue } from './snmpFields';

const DEFAULT_PORT = '161';
const DEFAULT_INTERVAL = '5';
const MAX_INTERVAL_MINUTES = 1440;

// Same rule as the server (app/snmp/address.py): an IP address or a hostname,
// no scheme, path, port or spaces.
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.:-]*[A-Za-z0-9])?\.?$/;
const PRINTABLE_ASCII_RE = /^[\x20-\x7e]*$/;

interface FormState {
  host: string;
  port: string;
  community: string;
  pollEnabled: boolean;
  interval: string;
}

const EMPTY_FORM: FormState = {
  host: '',
  port: DEFAULT_PORT,
  community: '',
  pollEnabled: false,
  interval: DEFAULT_INTERVAL,
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Server timestamps are Unix seconds. */
function formatTs(seconds: number): string {
  return formatDateTime(seconds * 1000, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * SNMP polling of an observer firmware node (repeater or room server) over
 * the LAN. Settings and polling never touch the radio. "Ask node" is the one
 * exception: it sends a single CLI command over RF, so it asks first.
 */
export function ContactSnmpSection({ contact }: { contact: Contact }) {
  const t = useT();
  const publicKey = contact.public_key;

  const [config, setConfig] = useState<ContactSnmpConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Bumped after each poll so the history chart reloads.
  const [historyVersion, setHistoryVersion] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);
  const [poll, setPoll] = useState<SnmpPollResponse | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [askArmed, setAskArmed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState<string | null>(null);
  const [removeArmed, setRemoveArmed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setConfig(null);
    setLoaded(false);
    setEditing(false);
    setPoll(null);
    setRequestError(null);
    setAskNote(null);
    setAskArmed(false);
    setRemoveArmed(false);
    api
      .getSnmpConfig(publicKey, controller.signal)
      .then((value) => {
        setConfig(value);
        setLoaded(true);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setRequestError(errorMessage(err));
        setLoaded(true);
      });
    return () => controller.abort();
  }, [publicKey]);

  const openForm = useCallback(() => {
    setForm({
      host: config?.host ?? '',
      port: config ? String(config.port) : DEFAULT_PORT,
      community: '',
      pollEnabled: config?.poll_enabled ?? false,
      interval: config ? String(config.poll_interval_minutes) : DEFAULT_INTERVAL,
    });
    setFormError(null);
    setAskNote(null);
    setAskArmed(false);
    setRemoveArmed(false);
    setEditing(true);
  }, [config]);

  const save = async () => {
    const host = form.host.trim();
    const port = Number(form.port);
    if (!host || !HOST_RE.test(host)) {
      setFormError(t('snmp_err_host'));
      return;
    }
    if (!/^\d+$/.test(form.port.trim()) || port < 1 || port > 65535) {
      setFormError(t('snmp_err_port'));
      return;
    }
    if (form.community.length > 64 || !PRINTABLE_ASCII_RE.test(form.community)) {
      setFormError(t('snmp_err_community'));
      return;
    }
    const interval = Number(form.interval);
    if (!/^\d+$/.test(form.interval.trim()) || interval < 1 || interval > MAX_INTERVAL_MINUTES) {
      setFormError(t('snmp_err_interval'));
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const saved = await api.saveSnmpConfig(publicKey, {
        host,
        port,
        community: form.community === '' ? null : form.community,
        poll_enabled: form.pollEnabled,
        poll_interval_minutes: interval,
      });
      setConfig(saved);
      setEditing(false);
      setPoll(null);
      setRequestError(null);
    } catch (err) {
      // 422 = the server's own validation refused a value the checks above let through.
      setFormError(
        err instanceof ApiError && err.status === 422
          ? t('snmp_err_invalid')
          : t('snmp_err_save', { error: errorMessage(err) })
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!removeArmed) {
      setRemoveArmed(true);
      return;
    }
    setRemoveArmed(false);
    try {
      await api.deleteSnmpConfig(publicKey);
      setConfig(null);
      setPoll(null);
      setRequestError(null);
    } catch (err) {
      setRequestError(errorMessage(err));
    }
  };

  const pollNow = async () => {
    setPolling(true);
    setRequestError(null);
    setRemoveArmed(false);
    try {
      const result = await api.pollSnmp(publicKey);
      setPoll(result);
      setHistoryVersion((version) => version + 1);
      setConfig((prev) =>
        prev
          ? result.ok
            ? { ...prev, last_ok_at: result.timestamp, last_error: null, last_error_at: null }
            : { ...prev, last_error: result.error, last_error_at: result.timestamp }
          : prev
      );
    } catch (err) {
      setRequestError(errorMessage(err));
    } finally {
      setPolling(false);
    }
  };

  // Two clicks: the lookup transmits one packet over RF.
  const askNode = async () => {
    if (!askArmed) {
      setAskArmed(true);
      setAskNote(null);
      return;
    }
    setAskArmed(false);
    setAsking(true);
    try {
      const result = await api.discoverSnmpAddress(publicKey);
      if (result.status === 'ok' && result.ip) {
        const ip = result.ip;
        setForm((prev) => ({ ...prev, host: ip }));
        setAskNote(t('snmp_ask_ok', { ip }));
      } else if (result.status === 'no_address') {
        setAskNote(t('snmp_ask_no_address', { reply: result.reply ?? '' }));
      } else if (result.status === 'unsupported') {
        setAskNote(t('snmp_ask_unsupported'));
      } else {
        setAskNote(t('snmp_ask_no_reply'));
      }
    } catch (err) {
      setAskNote(t('snmp_ask_failed', { error: errorMessage(err) }));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="px-5 py-3 border-b border-border space-y-2" data-testid="contact-snmp">
      <div className="flex items-center gap-2 text-sm">
        <Network className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{t('snmp_title')}</span>
        {config && !editing && (
          <span className="ml-auto truncate font-mono text-xs text-muted-foreground">
            {config.host}:{config.port}
          </span>
        )}
      </div>

      {requestError && (
        <p className="text-xs text-destructive" role="alert">
          {requestError}
        </p>
      )}

      {loaded && !config && !editing && (
        <>
          <p className="text-xs text-muted-foreground">{t('snmp_intro')}</p>
          <Button type="button" variant="outline" size="sm" onClick={openForm}>
            {t('snmp_setup')}
          </Button>
        </>
      )}

      {editing && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div className="space-y-1">
              <Label htmlFor="snmp-host">{t('snmp_host')}</Label>
              <Input
                id="snmp-host"
                value={form.host}
                autoComplete="off"
                placeholder={t('snmp_host_placeholder')}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="snmp-port">{t('snmp_port')}</Label>
              <Input
                id="snmp-port"
                value={form.port}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => setForm({ ...form, port: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="snmp-community">{t('snmp_community')}</Label>
            <Input
              id="snmp-community"
              type="password"
              value={form.community}
              autoComplete="off"
              placeholder={
                config ? t('snmp_community_keep') : t('snmp_community_default_placeholder')
              }
              onChange={(e) => setForm({ ...form, community: e.target.value })}
            />
            <p className="text-[0.6875rem] text-muted-foreground">{t('snmp_community_note')}</p>
          </div>
          <div className="space-y-1">
            <Button
              type="button"
              variant={askArmed ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => void askNode()}
              disabled={asking || saving}
            >
              {asking ? t('snmp_asking') : askArmed ? t('snmp_ask_confirm') : t('snmp_ask')}
            </Button>
            <p className="text-[0.6875rem] text-muted-foreground">{t('snmp_ask_note')}</p>
            {askNote && (
              <p className="text-xs" data-testid="snmp-ask-note">
                {askNote}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm" htmlFor="snmp-poll-enabled">
              <input
                id="snmp-poll-enabled"
                type="checkbox"
                checked={form.pollEnabled}
                onChange={(e) => setForm({ ...form, pollEnabled: e.target.checked })}
              />
              {t('snmp_schedule')}
            </label>
            {form.pollEnabled && (
              <div className="flex items-center gap-2">
                <Label htmlFor="snmp-interval">{t('snmp_interval')}</Label>
                <Input
                  id="snmp-interval"
                  className="w-20"
                  value={form.interval}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(e) => setForm({ ...form, interval: e.target.value })}
                />
              </div>
            )}
            <p className="text-[0.6875rem] text-muted-foreground">{t('snmp_schedule_note')}</p>
          </div>
          {formError && (
            <p className="text-xs text-destructive" role="alert">
              {formError}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? t('snmp_saving') : t('snmp_save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              {t('common_cancel')}
            </Button>
          </div>
        </form>
      )}

      {config && !editing && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void pollNow()} disabled={polling}>
              {polling ? t('snmp_polling') : t('snmp_poll_now')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={openForm}>
              {t('snmp_edit')}
            </Button>
            <Button
              type="button"
              variant={removeArmed ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => void remove()}
            >
              {removeArmed ? t('snmp_remove_confirm') : t('snmp_remove')}
            </Button>
          </div>
          <p className="text-[0.6875rem] text-muted-foreground" data-testid="snmp-status">
            {config.last_ok_at
              ? t('snmp_last_ok', { time: formatTs(config.last_ok_at) })
              : t('snmp_never_polled')}
            {config.community_is_default ? ` ${t('snmp_community_is_default')}` : ''}{' '}
            {config.poll_enabled
              ? t('snmp_schedule_on', { minutes: config.poll_interval_minutes })
              : t('snmp_schedule_off')}
          </p>
          {config.last_error && (
            <p className="text-xs text-destructive" role="alert" data-testid="snmp-last-error">
              {t('snmp_last_error', {
                time: config.last_error_at ? formatTs(config.last_error_at) : '-',
                error: config.last_error,
              })}
            </p>
          )}
        </>
      )}

      {config && !editing && <SnmpHistoryChart publicKey={publicKey} version={historyVersion} />}

      {poll?.ok && poll.values && !editing && (
        <div className="space-y-2" data-testid="snmp-values">
          {SNMP_GROUPS.map(({ group, labelKey }) => (
            <div key={group}>
              <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                {t(labelKey)}
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 text-xs">
                {SNMP_FIELDS.filter((field) => field.group === group).map((field) => (
                  <div key={field.key} className="contents" data-testid={`snmp-row-${field.key}`}>
                    <dt className="text-muted-foreground">{t(field.labelKey)}</dt>
                    <dd className="text-right font-mono">
                      {formatSnmpValue(field, poll.values ?? {})}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
