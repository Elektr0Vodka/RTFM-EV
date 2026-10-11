import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { RadioTower } from 'lucide-react';

import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Toaster, toast } from '../components/ui/sonner';
import { useT } from '../i18n';
import { cn } from '@/lib/utils';
import {
  gatewayApi,
  radioHref,
  type GatewayRadioInfo,
  type RadioAction,
  type RadioInput,
  type RadioTransport,
} from './api';
import { RADIO_STATE_DOT, RADIO_STATE_LABEL } from './radioState';

const REFRESH_MS = 3000;

type TransportType = RadioTransport['type'];

interface FormState {
  name: string;
  type: TransportType;
  serialPort: string;
  baudrate: string;
  host: string;
  tcpPort: string;
  bleAddress: string;
  blePin: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'serial',
  serialPort: '',
  baudrate: '115200',
  host: '',
  tcpPort: '5000',
  bleAddress: '',
  blePin: '',
};

function formFromRadio(radio: GatewayRadioInfo): FormState {
  const form = { ...EMPTY_FORM, name: radio.name, type: radio.transport.type };
  if (radio.transport.type === 'serial') {
    form.serialPort = radio.transport.port;
    form.baudrate = String(radio.transport.baudrate ?? 115200);
  } else if (radio.transport.type === 'tcp') {
    form.host = radio.transport.host;
    form.tcpPort = String(radio.transport.port ?? 5000);
  } else {
    form.bleAddress = radio.transport.address;
  }
  return form;
}

function inputFromForm(form: FormState): RadioInput {
  const name = form.name.trim();
  if (form.type === 'serial') {
    return {
      name,
      transport: {
        type: 'serial',
        port: form.serialPort.trim(),
        baudrate: Number(form.baudrate) || 115200,
      },
    };
  }
  if (form.type === 'tcp') {
    return {
      name,
      transport: { type: 'tcp', host: form.host.trim(), port: Number(form.tcpPort) || 5000 },
    };
  }
  return {
    name,
    transport: { type: 'ble', address: form.bleAddress.trim(), pin: form.blePin.trim() },
  };
}

function describeTransport(transport: RadioTransport): string {
  if (transport.type === 'serial') return transport.port || 'auto';
  if (transport.type === 'tcp') return `${transport.host}:${transport.port ?? 5000}`;
  return transport.address;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function RadioForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  submitLabel: string;
  onSubmit: (input: RadioInput) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) => setForm((previous) => ({ ...previous, ...patch }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(inputFromForm(form));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const transportOptions: { type: TransportType; label: string }[] = [
    { type: 'serial', label: t('gateway_transport_serial') },
    { type: 'tcp', label: t('gateway_transport_tcp') },
    { type: 'ble', label: t('gateway_transport_ble') },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-3" aria-label={submitLabel}>
      <div className="space-y-1">
        <Label htmlFor="gateway-radio-name">{t('common_name')}</Label>
        <Input
          id="gateway-radio-name"
          value={form.name}
          maxLength={64}
          required
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="gateway-radio-transport">{t('gateway_field_connection')}</Label>
        <select
          id="gateway-radio-transport"
          value={form.type}
          onChange={(e) => set({ type: e.target.value as TransportType })}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {transportOptions.map((option) => (
            <option key={option.type} value={option.type}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {form.type === 'serial' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="gateway-radio-serial-port">{t('gateway_field_serial_port')}</Label>
            <Input
              id="gateway-radio-serial-port"
              value={form.serialPort}
              placeholder="/dev/ttyUSB0"
              onChange={(e) => set({ serialPort: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gateway-radio-baudrate">{t('gateway_field_baudrate')}</Label>
            <Input
              id="gateway-radio-baudrate"
              inputMode="numeric"
              value={form.baudrate}
              onChange={(e) => set({ baudrate: e.target.value })}
            />
          </div>
        </div>
      )}

      {form.type === 'tcp' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="gateway-radio-host">{t('gateway_field_host')}</Label>
            <Input
              id="gateway-radio-host"
              value={form.host}
              required
              placeholder="192.168.1.100"
              onChange={(e) => set({ host: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gateway-radio-tcp-port">{t('gateway_field_tcp_port')}</Label>
            <Input
              id="gateway-radio-tcp-port"
              inputMode="numeric"
              value={form.tcpPort}
              onChange={(e) => set({ tcpPort: e.target.value })}
            />
          </div>
        </div>
      )}

      {form.type === 'ble' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="gateway-radio-ble-address">{t('gateway_field_ble_address')}</Label>
            <Input
              id="gateway-radio-ble-address"
              value={form.bleAddress}
              required
              placeholder="AA:BB:CC:DD:EE:FF"
              onChange={(e) => set({ bleAddress: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gateway-radio-ble-pin">{t('gateway_field_ble_pin')}</Label>
            <Input
              id="gateway-radio-ble-pin"
              type="password"
              autoComplete="off"
              value={form.blePin}
              required
              onChange={(e) => set({ blePin: e.target.value })}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          {t('common_cancel')}
        </Button>
      </div>
    </form>
  );
}

function RadioCard({ radio, onChanged }: { radio: GatewayRadioInfo; onChanged: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');
  const [deleteData, setDeleteData] = useState(false);
  const [logLines, setLogLines] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const href = radioHref(radio);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      if (done) toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(t('gateway_action_failed'), { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const action = (name: RadioAction) => run(() => gatewayApi.radioAction(radio.id, name));

  const toggleLog = async () => {
    if (logLines !== null) {
      setLogLines(null);
      return;
    }
    await run(async () => setLogLines((await gatewayApi.radioLog(radio.id)).lines));
  };

  return (
    <li
      className="rounded-lg border border-border bg-card p-4"
      data-testid={`gateway-radio-${radio.id}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn('h-2.5 w-2.5 shrink-0 rounded-full', RADIO_STATE_DOT[radio.state])}
          aria-hidden="true"
        />
        <h2 className="text-base font-medium">{radio.name}</h2>
        <span className="text-xs text-muted-foreground">{t(RADIO_STATE_LABEL[radio.state])}</span>
        {radio.restarts > 0 && (
          <span className="text-xs text-warning">
            {t('gateway_radio_restarts', { count: radio.restarts })}
          </span>
        )}
      </div>

      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex gap-1">
          <dt>{t('gateway_field_connection')}:</dt>
          <dd className="font-mono text-foreground">
            {radio.transport.type} {describeTransport(radio.transport)}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>{t('gateway_radio_status')}:</dt>
          <dd className="text-foreground">
            {radio.radio_connected
              ? t('gateway_radio_connected', { name: radio.radio_name ?? radio.name })
              : t('gateway_radio_not_connected')}
          </dd>
        </div>
      </dl>

      {mode === 'view' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {href ? (
            <Button asChild size="sm">
              <a href={href}>{t('gateway_radio_open')}</a>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t('gateway_radio_waiting_first_connect')}
            </span>
          )}
          {radio.state === 'stopped' ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => action('start')}>
              {t('gateway_radio_start')}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => action('restart')}>
                {t('gateway_radio_restart')}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => action('stop')}>
                {t('gateway_radio_stop')}
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={toggleLog}>
            {t('gateway_radio_log')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('edit')}>
            {t('gateway_radio_edit')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('remove')}>
            {t('gateway_radio_remove')}
          </Button>
        </div>
      )}

      {mode === 'edit' && (
        <div className="mt-3">
          <RadioForm
            initial={formFromRadio(radio)}
            submitLabel={t('gateway_save_radio')}
            onCancel={() => setMode('view')}
            onSubmit={async (input) => {
              await gatewayApi.updateRadio(radio.id, input);
              toast.success(t('gateway_radio_saved'));
              setMode('view');
              onChanged();
            }}
          />
        </div>
      )}

      {mode === 'remove' && (
        <div className="mt-3 space-y-2" role="group" aria-label={t('gateway_radio_remove')}>
          <p className="text-sm">{t('gateway_remove_confirm', { name: radio.name })}</p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={deleteData}
              onChange={(e) => setDeleteData(e.target.checked)}
            />
            {t('gateway_remove_delete_data')}
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                run(() => gatewayApi.removeRadio(radio.id, deleteData), t('gateway_radio_removed'))
              }
            >
              {t('gateway_remove_confirm_button')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode('view')}>
              {t('common_cancel')}
            </Button>
          </div>
        </div>
      )}

      {logLines !== null && (
        <pre
          className="mt-3 max-h-64 overflow-auto rounded-md bg-muted p-2 text-[0.6875rem] leading-snug"
          aria-label={t('gateway_radio_log')}
        >
          {logLines.length > 0 ? logLines.join('\n') : t('gateway_radio_log_empty')}
        </pre>
      )}
    </li>
  );
}

/**
 * The radios page of multi-radio mode, served by the gateway at /gateway/.
 * It replaces the whole app there: no radio API exists behind this URL.
 */
export function GatewayApp() {
  const t = useT();
  const [radios, setRadios] = useState<GatewayRadioInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    gatewayApi
      .listRadios()
      .then((list) => {
        setRadios(list);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorText(err)));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <RadioTower className="h-5 w-5" aria-hidden="true" />
            {t('gateway_radios_title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('gateway_radios_intro')}</p>
        </header>

        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {t('gateway_load_failed')}: {loadError}
          </p>
        )}
        {radios === null && !loadError && (
          <p className="text-sm text-muted-foreground">{t('common_loading')}</p>
        )}
        {radios?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('gateway_no_radios')}</p>
        )}

        <ul className="space-y-3">
          {radios?.map((radio) => (
            <RadioCard key={radio.id} radio={radio} onChanged={load} />
          ))}
        </ul>

        {adding ? (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-base font-medium">{t('gateway_add_radio')}</h2>
            <RadioForm
              initial={EMPTY_FORM}
              submitLabel={t('gateway_add_radio')}
              onCancel={() => setAdding(false)}
              onSubmit={async (input) => {
                await gatewayApi.addRadio(input);
                toast.success(t('gateway_radio_added'));
                setAdding(false);
                load();
              }}
            />
          </section>
        ) : (
          <Button size="sm" onClick={() => setAdding(true)}>
            {t('gateway_add_radio')}
          </Button>
        )}
      </main>
      <Toaster position="top-right" />
    </div>
  );
}
