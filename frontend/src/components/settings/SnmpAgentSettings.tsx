import { useEffect, useState } from 'react';

import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type { SnmpAgentState } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const PRINTABLE_ASCII_RE = /^[\x20-\x7e]+$/;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * RTFM-EV's own SNMP agent (off by default): answers SNMPv2c GET, GETNEXT and
 * GETBULK with the same OIDs as the observer firmware, so a monitoring system
 * can poll this host like a firmware node. Self-contained: it loads and saves
 * through /api/snmp-agent and shows whether the listener is running.
 */
export function SnmpAgentSettings() {
  const t = useT();
  const [state, setState] = useState<SnmpAgentState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState('161');
  const [community, setCommunity] = useState('public');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const adopt = (next: SnmpAgentState) => {
    setState(next);
    setEnabled(next.settings.enabled);
    setPort(String(next.settings.port));
    setCommunity(next.settings.community);
  };

  useEffect(() => {
    const controller = new AbortController();
    api
      .getSnmpAgent(controller.signal)
      .then(adopt)
      .catch((err) => {
        if (!isAbortError(err)) setError(errorMessage(err));
      });
    return () => controller.abort();
  }, []);

  const save = async () => {
    const portNumber = Number(port);
    if (!/^\d+$/.test(port.trim()) || portNumber < 1 || portNumber > 65535) {
      setError(t('snmp_err_port'));
      return;
    }
    if (community.length > 64 || !PRINTABLE_ASCII_RE.test(community)) {
      setError(t('snmp_agent_err_community'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      adopt(await api.saveSnmpAgent({ enabled, port: portNumber, community }));
    } catch (err) {
      setError(t('snmp_err_save', { error: errorMessage(err) }));
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    state !== null &&
    (enabled !== state.settings.enabled ||
      port !== String(state.settings.port) ||
      community !== state.settings.community);

  return (
    <div className="space-y-3" data-testid="snmp-agent-settings">
      <h3 className="text-base font-semibold tracking-tight">{t('snmp_agent_heading')}</h3>
      <p className="text-[0.8125rem] text-muted-foreground">{t('snmp_agent_desc')}</p>
      <label className="flex items-center gap-2 text-sm" htmlFor="snmp-agent-enabled">
        <input
          id="snmp-agent-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {t('snmp_agent_enable')}
      </label>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <div className="space-y-1">
          <Label htmlFor="snmp-agent-port">{t('snmp_agent_port')}</Label>
          <Input
            id="snmp-agent-port"
            value={port}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="snmp-agent-community">{t('snmp_community')}</Label>
          <Input
            id="snmp-agent-community"
            value={community}
            autoComplete="off"
            onChange={(e) => setCommunity(e.target.value)}
          />
        </div>
      </div>
      <p className="text-[0.6875rem] text-muted-foreground">{t('snmp_agent_note')}</p>

      {state && (
        <p className="text-xs" data-testid="snmp-agent-status">
          {state.running
            ? t('snmp_agent_running', {
                port: state.settings.port,
                requests: state.requests,
                refused: state.bad_community,
              })
            : state.error
              ? t('snmp_agent_failed', { error: state.error })
              : t('snmp_agent_off')}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        onClick={() => void save()}
        disabled={saving || state === null || !dirty}
      >
        {saving ? t('snmp_saving') : t('snmp_save')}
      </Button>
    </div>
  );
}
