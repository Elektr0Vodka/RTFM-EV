import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayApp } from '../gateway/GatewayApp';
import { HeaderRadioMenu } from '../gateway/HeaderRadioMenu';
import type { GatewayRadioInfo } from '../gateway/api';

const KEY_A = '0d1d00147f96';
const KEY_B = 'b1b2b3b4b5b6';

function radio(overrides: Partial<GatewayRadioInfo> & { id: number }): GatewayRadioInfo {
  return {
    name: `Radio ${overrides.id}`,
    enabled: true,
    transport: { type: 'tcp', host: '10.0.0.5', port: 5000 },
    database_path: `data/radios/${overrides.id}/meshcore.db`,
    public_key: null,
    url_key: null,
    url: null,
    state: 'running',
    restarts: 0,
    radio_connected: false,
    radio_name: null,
    ...overrides,
  };
}

const RADIOS: GatewayRadioInfo[] = [
  radio({ id: 1, name: '868 MHz', url_key: KEY_A, url: `r/${KEY_A}/` }),
  radio({ id: 2, name: '433 MHz', url_key: KEY_B, url: `r/${KEY_B}/`, state: 'crashed' }),
  radio({ id: 3, name: 'New one', state: 'starting' }),
];

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];

type Handler = (call: Call) => { status?: number; json: unknown } | undefined;

function mockGateway(handler?: Handler) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const reply = handler?.(call) ?? { json: RADIOS };
      return new Response(JSON.stringify(reply.json), {
        status: reply.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  delete window.__RTFM_GATEWAY__;
  vi.unstubAllGlobals();
});

describe('HeaderRadioMenu', () => {
  it('renders nothing in single-radio mode', () => {
    mockGateway();
    const { container } = render(<HeaderRadioMenu />);
    expect(container).toBeEmptyDOMElement();
    expect(calls).toHaveLength(0);
  });

  it('shows the current radio and links to the others', async () => {
    window.__RTFM_GATEWAY__ = {
      page: 'workspace',
      base: '../../gateway/',
      radio: { id: 1, name: '868 MHz', urlKey: KEY_A },
    };
    mockGateway();
    render(<HeaderRadioMenu />);

    const trigger = screen.getByRole('button', { name: 'Switch radio' });
    expect(trigger).toHaveTextContent('868 MHz');
    expect(calls).toHaveLength(0);

    fireEvent.click(trigger);
    const other = await screen.findByRole('menuitem', { name: /433 MHz/ });
    expect(calls[0].url).toBe('../../gateway/api/radios');
    expect(other).toHaveAttribute('href', `../../gateway/../r/${KEY_B}/`);

    const current = screen.getByRole('menuitem', { name: /868 MHz/ });
    expect(current).not.toHaveAttribute('href');
    expect(current).toHaveAttribute('aria-current', 'true');

    const notYet = screen.getByRole('menuitem', { name: /New one/ });
    expect(notYet).not.toHaveAttribute('href');
    expect(notYet).toHaveAttribute('title', 'Has not connected yet');

    expect(screen.getByRole('menuitem', { name: 'Manage radios' })).toHaveAttribute(
      'href',
      '../../gateway/'
    );
  });
});

describe('GatewayApp', () => {
  beforeEach(() => {
    window.__RTFM_GATEWAY__ = { page: 'radios', base: './', radio: null };
  });

  it('lists the radios with their state and workspace link', async () => {
    mockGateway();
    render(<GatewayApp />);

    const first = await screen.findByTestId('gateway-radio-1');
    expect(calls[0]).toMatchObject({ url: './api/radios', method: 'GET' });
    expect(within(first).getByRole('heading', { name: '868 MHz' })).toBeInTheDocument();
    expect(within(first).getByText('Running')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      `./../r/${KEY_A}/`
    );

    const third = screen.getByTestId('gateway-radio-3');
    expect(within(third).queryByRole('link', { name: 'Open' })).toBeNull();
    expect(
      within(third).getByText('Opens after the radio has connected once.')
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('gateway-radio-2')).getByText('Crashed')).toBeInTheDocument();
  });

  it('stops and restarts a radio through the gateway', async () => {
    mockGateway();
    render(<GatewayApp />);
    const first = await screen.findByTestId('gateway-radio-1');

    fireEvent.click(within(first).getByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ url: './api/radios/1/stop', method: 'POST', body: undefined })
    );
    fireEvent.click(within(first).getByRole('button', { name: 'Restart' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: './api/radios/1/restart',
        method: 'POST',
        body: undefined,
      })
    );
  });

  it('adds a TCP radio and shows a refusal from the gateway', async () => {
    let refuse = true;
    mockGateway((call) => {
      if (call.method !== 'POST') return undefined;
      if (refuse) {
        return { status: 400, json: { detail: 'Radio 4 uses the same connection as radio 1.' } };
      }
      return { status: 201, json: radio({ id: 4, name: 'Third' }) };
    });
    render(<GatewayApp />);
    await screen.findByTestId('gateway-radio-1');

    fireEvent.click(screen.getByRole('button', { name: 'Add radio' }));
    const form = screen.getByRole('form', { name: 'Add radio' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: ' Third ' } });
    fireEvent.change(within(form).getByLabelText('Connection'), { target: { value: 'tcp' } });
    fireEvent.change(within(form).getByLabelText('Host'), { target: { value: '10.0.0.9' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add radio' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Radio 4 uses the same connection as radio 1.'
    );
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      url: './api/radios',
      method: 'POST',
      body: { name: 'Third', transport: { type: 'tcp', host: '10.0.0.9', port: 5000 } },
    });

    refuse = false;
    fireEvent.click(within(form).getByRole('button', { name: 'Add radio' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add radio' })).toBeNull());
  });

  it('sends serial and BLE connections in the gateway format', async () => {
    mockGateway((call) =>
      call.method === 'POST' ? { status: 201, json: radio({ id: 4 }) } : undefined
    );
    render(<GatewayApp />);
    await screen.findByTestId('gateway-radio-1');

    fireEvent.click(screen.getByRole('button', { name: 'Add radio' }));
    let form = screen.getByRole('form', { name: 'Add radio' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'USB' } });
    fireEvent.change(within(form).getByLabelText('Serial port'), {
      target: { value: '/dev/ttyUSB1' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add radio' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add radio' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Add radio' }));
    form = screen.getByRole('form', { name: 'Add radio' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Blue' } });
    fireEvent.change(within(form).getByLabelText('Connection'), { target: { value: 'ble' } });
    fireEvent.change(within(form).getByLabelText('BLE address'), { target: { value: 'AA:BB' } });
    fireEvent.change(within(form).getByLabelText('BLE PIN'), { target: { value: '123456' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add radio' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add radio' })).toBeNull());

    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { name: 'USB', transport: { type: 'serial', port: '/dev/ttyUSB1', baudrate: 115200 } },
      { name: 'Blue', transport: { type: 'ble', address: 'AA:BB', pin: '123456' } },
    ]);
  });

  it('asks before removing a radio', async () => {
    mockGateway((call) => (call.method === 'DELETE' ? { json: { status: 'ok' } } : undefined));
    render(<GatewayApp />);
    const first = await screen.findByTestId('gateway-radio-1');

    fireEvent.click(within(first).getByRole('button', { name: 'Remove' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(within(first).getByText(/Remove radio "868 MHz"\?/)).toBeInTheDocument();

    fireEvent.click(within(first).getByRole('button', { name: 'Remove radio' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: './api/radios/1?delete_data=false',
        method: 'DELETE',
        body: undefined,
      })
    );
  });

  it('shows the worker log on request', async () => {
    mockGateway((call) =>
      call.url.includes('/log') ? { json: { lines: ['first line', 'second line'] } } : undefined
    );
    render(<GatewayApp />);
    const first = await screen.findByTestId('gateway-radio-1');

    fireEvent.click(within(first).getByRole('button', { name: 'Log' }));
    expect(await within(first).findByText(/first line/)).toBeInTheDocument();
    expect(calls).toContainEqual({
      url: './api/radios/1/log?limit=200',
      method: 'GET',
      body: undefined,
    });
  });
});
