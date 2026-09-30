import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { MeshHealthView } from '../components/MeshHealthView';
import { MeshPowerOutagePanel } from '../components/MeshPowerOutagePanel';
import type { Contact } from '../types';
import { CONTACT_TYPE_REPEATER } from '../types';

function makeContact(i: number, overrides: Partial<Contact> = {}): Contact {
  return {
    public_key: i.toString(16).padStart(2, '0').repeat(32),
    name: `Node ${String(i).padStart(2, '0')}`,
    type: CONTACT_TYPE_REPEATER,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    route_override_path: null,
    route_override_len: null,
    route_override_hash_mode: null,
    last_advert: null,
    lat: null,
    lon: null,
    manual_lat: null,
    manual_lon: null,
    // Heard i minutes ago: inside the default 7d window, Node 01 most recent.
    last_seen: Math.floor(Date.now() / 1000) - i * 60,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...overrides,
  };
}

const CONTACTS = Array.from({ length: 12 }, (_, i) => makeContact(i + 1));

function bodyNames(): string[] {
  const table = screen.getByRole('table');
  const body = table.querySelector('tbody') as HTMLElement;
  return within(body)
    .getAllByRole('row')
    .map((r) => within(r).getAllByRole('cell')[0].textContent ?? '');
}

describe('MeshPowerOutagePanel table', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getAdvertLinks').mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('paginates the node table by the page size', async () => {
    render(<MeshPowerOutagePanel contacts={CONTACTS} refreshKey={0} pageSize={5} />);
    await waitFor(() => expect(bodyNames()).toHaveLength(5));
    expect(screen.getByText('1–5 of 12')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next ›' }));
    expect(screen.getByText('6–10 of 12')).toBeInTheDocument();
    expect(bodyNames()).toEqual(['Node 06', 'Node 07', 'Node 08', 'Node 09', 'Node 10']);

    fireEvent.click(screen.getByRole('button', { name: '»' }));
    expect(bodyNames()).toEqual(['Node 11', 'Node 12']);
  });

  it('shows every row and no pager when the page size is All (0)', async () => {
    render(<MeshPowerOutagePanel contacts={CONTACTS} refreshKey={0} pageSize={0} />);
    await waitFor(() => expect(bodyNames()).toHaveLength(12));
    expect(screen.queryByRole('button', { name: 'Next ›' })).not.toBeInTheDocument();
  });

  it('persists a page-size change through the shared Mesh Health setting', async () => {
    const onSave = vi.fn();
    render(
      <MeshPowerOutagePanel
        contacts={CONTACTS}
        refreshKey={0}
        pageSize={5}
        onSaveAppSettings={onSave}
      />
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Show max rows' }), {
      target: { value: '25' },
    });
    expect(onSave).toHaveBeenCalledWith({ mesh_health_page_size: 25 });
  });

  it('sorts by a column header and toggles the direction on a second click', async () => {
    render(<MeshPowerOutagePanel contacts={CONTACTS} refreshKey={0} pageSize={3} />);
    await waitFor(() => expect(bodyNames()).toHaveLength(3));

    const heard = screen.getByRole('columnheader', { name: /Last heard/ });
    fireEvent.click(heard);
    expect(heard).toHaveAttribute('aria-sort', 'descending');
    expect(bodyNames()).toEqual(['Node 01', 'Node 02', 'Node 03']);

    fireEvent.click(heard);
    expect(heard).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyNames()).toEqual(['Node 12', 'Node 11', 'Node 10']);

    const node = screen.getByRole('columnheader', { name: /Node/ });
    fireEvent.click(node);
    fireEvent.click(node);
    expect(node).toHaveAttribute('aria-sort', 'descending');
    expect(bodyNames()).toEqual(['Node 12', 'Node 11', 'Node 10']);
  });

  it('returns to the first page when the sort changes', async () => {
    render(<MeshPowerOutagePanel contacts={CONTACTS} refreshKey={0} pageSize={5} />);
    await waitFor(() => expect(bodyNames()).toHaveLength(5));
    fireEvent.click(screen.getByRole('button', { name: 'Next ›' }));
    expect(screen.getByText('6–10 of 12')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('columnheader', { name: /Node/ }));
    expect(screen.getByText('1–5 of 12')).toBeInTheDocument();
  });
});

describe('MeshHealthView Power Outage go-to-top button', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getAdvertLinks').mockResolvedValue([]);
    localStorage.setItem('rtfm-meshhealth-tab', 'power-outage');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('rtfm-meshhealth-tab');
  });

  it('appears after scrolling down and scrolls the page back to the top', async () => {
    render(<MeshHealthView config={null} contacts={CONTACTS} />);
    await waitFor(() => expect(bodyNames().length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Go to top' })).not.toBeInTheDocument();

    const scroller = screen.getByRole('table').closest('.overflow-y-auto') as HTMLElement;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 500 });
    fireEvent.scroll(scroller);

    fireEvent.click(screen.getByRole('button', { name: 'Go to top' }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
