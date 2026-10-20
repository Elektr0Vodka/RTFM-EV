import { useCallback, useEffect, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type { WardriveAdminConfig, WardriveBrokerIn } from '../../types';
import { RESERVED_BROKER_IDS } from '../../wardrive/forward/brokers';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const SELECT_CLASS =
  'block h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** An id from the name, unique among the ids in use (the server checks it too). */
export function brokerIdFor(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'broker';
  const start = base.length < 2 ? `${base}-broker` : base;
  let id = start;
  for (let n = 2; taken.has(id) || RESERVED_BROKER_IDS.has(id); n++) id = `${start}-${n}`;
  return id;
}

interface Draft {
  name: string;
  url: string;
  format: 'wardrive' | 'packets';
  label: string;
  region: string;
  auth: 'companion' | 'password';
  username: string;
  password: string;
}

const EMPTY: Draft = {
  name: '',
  url: '',
  format: 'packets',
  label: '',
  region: '',
  auth: 'companion',
  username: '',
  password: '',
};

/**
 * The brokers the wardrive page offers drivers. The DutchMeshCore collectors
 * and meshcore-analyzer.eu are built in; the owner adds others. Drivers only
 * switch them on per radio; they cannot add their own.
 */
export function WardriveBrokersCard() {
  const t = useT();
  const [config, setConfig] = useState<WardriveAdminConfig | null>(null);
  const [region, setRegion] = useState('');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await api.getWardriveConfig();
      setConfig(c);
      setRegion(c.analyzer_region);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (body: Parameters<typeof api.putWardriveConfig>[0]) => {
    try {
      const c = await api.putWardriveConfig(body);
      setConfig(c);
      setRegion(c.analyzer_region);
      setError(null);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };

  const custom = config?.brokers ?? [];
  const builtins = config?.builtin_brokers ?? [];

  const add = async () => {
    const taken = new Set([...builtins, ...custom].map((b) => b.id));
    const broker: WardriveBrokerIn = {
      id: brokerIdFor(draft.name, taken),
      name: draft.name.trim(),
      url: draft.url.trim(),
      auth: draft.auth,
      format: draft.format,
    };
    if (draft.format === 'wardrive') broker.label = draft.label.trim();
    else broker.region = draft.region.trim();
    if (draft.auth === 'password') {
      broker.username = draft.username;
      broker.password = draft.password;
    }
    if (await save({ brokers: [...custom, broker] })) setDraft(EMPTY);
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const where = (b: WardriveBrokerIn) =>
    b.format === 'wardrive'
      ? t('settings_wardrive_brokers_where_label', { label: b.label ?? '' })
      : t('settings_wardrive_brokers_where_region', { region: b.region ?? '' });

  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="wardrive-brokers">
      <h4 className="text-sm font-semibold">{t('settings_wardrive_brokers_heading')}</h4>
      <p className="text-xs text-muted-foreground">{t('settings_wardrive_brokers_desc')}</p>
      <ul className="space-y-1">
        {builtins.map((b) => (
          <li key={b.id} className="text-xs">
            <span className="font-medium">{b.name}</span>{' '}
            <span className="text-muted-foreground">
              {b.url}, {where(b)}, {t('settings_wardrive_brokers_builtin')}
            </span>
          </li>
        ))}
        {custom.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-1 text-xs">
            <span className="font-medium">{b.name}</span>
            <span className="text-muted-foreground">
              {b.url}, {where(b)}
              {b.auth === 'password' ? `, ${t('settings_wardrive_brokers_with_account')}` : ''}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              aria-label={t('settings_wardrive_brokers_remove', { name: b.name })}
              onClick={() => void save({ brokers: custom.filter((c) => c.id !== b.id) })}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="wardrive-analyzer-region">
            {t('settings_wardrive_brokers_analyzer_region')}
          </Label>
          <Input
            id="wardrive-analyzer-region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="w-24"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!config || region === config.analyzer_region}
          onClick={() => void save({ analyzer_region: region.trim() })}
        >
          {t('settings_wardrive_brokers_save_region')}
        </Button>
      </div>

      <h5 className="pt-1 text-xs font-semibold">{t('settings_wardrive_brokers_add_heading')}</h5>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="wardrive-broker-name">{t('settings_wardrive_brokers_name')}</Label>
          <Input
            id="wardrive-broker-name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="wardrive-broker-url">{t('settings_wardrive_brokers_url')}</Label>
          <Input
            id="wardrive-broker-url"
            value={draft.url}
            placeholder="wss://mqtt.example.org:443"
            onChange={(e) => set({ url: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="wardrive-broker-format">{t('settings_wardrive_brokers_format')}</Label>
          <select
            id="wardrive-broker-format"
            className={SELECT_CLASS}
            value={draft.format}
            onChange={(e) => set({ format: e.target.value as Draft['format'] })}
          >
            <option value="packets">{t('settings_wardrive_brokers_format_packets')}</option>
            <option value="wardrive">{t('settings_wardrive_brokers_format_wardrive')}</option>
          </select>
        </div>
        {draft.format === 'wardrive' ? (
          <div className="space-y-1">
            <Label htmlFor="wardrive-broker-label">{t('settings_wardrive_brokers_label')}</Label>
            <Input
              id="wardrive-broker-label"
              value={draft.label}
              placeholder="wardriver"
              onChange={(e) => set({ label: e.target.value })}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="wardrive-broker-region">{t('settings_wardrive_brokers_region')}</Label>
            <Input
              id="wardrive-broker-region"
              value={draft.region}
              placeholder="nl"
              onChange={(e) => set({ region: e.target.value })}
            />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="wardrive-broker-auth">{t('settings_wardrive_brokers_auth')}</Label>
          <select
            id="wardrive-broker-auth"
            className={SELECT_CLASS}
            value={draft.auth}
            onChange={(e) => set({ auth: e.target.value as Draft['auth'] })}
          >
            <option value="companion">{t('settings_wardrive_brokers_auth_companion')}</option>
            <option value="password">{t('settings_wardrive_brokers_auth_password')}</option>
          </select>
        </div>
        {draft.auth === 'password' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="wardrive-broker-username">
                {t('settings_wardrive_brokers_username')}
              </Label>
              <Input
                id="wardrive-broker-username"
                autoComplete="off"
                value={draft.username}
                onChange={(e) => set({ username: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wardrive-broker-password">
                {t('settings_wardrive_brokers_password')}
              </Label>
              <Input
                id="wardrive-broker-password"
                type="password"
                autoComplete="new-password"
                value={draft.password}
                onChange={(e) => set({ password: e.target.value })}
              />
            </div>
            <p className="text-xs text-warning sm:col-span-2">
              {t('settings_wardrive_brokers_password_warning')}
            </p>
          </>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        disabled={!draft.name.trim() || !draft.url.trim()}
        onClick={() => void add()}
      >
        {t('settings_wardrive_brokers_add')}
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
