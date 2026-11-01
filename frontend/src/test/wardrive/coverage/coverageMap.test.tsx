// The coverage map's UI with the map glue mocked: what it asks the server
// for, what it hands the map, and what it says.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CoverageMapGLProps } from '../../../wardrive/coverage/CoverageMapGL';

let gl: CoverageMapGLProps;
vi.mock('../../../wardrive/coverage/CoverageMapGL', () => ({
  CoverageMapGL: (props: CoverageMapGLProps) => {
    gl = props;
    return <div data-testid="gl" />;
  },
}));

let dialog: { title: string; framing?: { located: unknown[] } } | null = null;
vi.mock('../../../share/ShareCardDialog', () => ({
  ShareCardDialog: (props: { title: string; framing?: { located: unknown[] } }) => {
    dialog = props;
    return <div data-testid="share-dialog">{props.title}</div>;
  },
}));

import type { CoverageApi } from '../../../wardrive/coverage/api';
import { CoverageMap } from '../../../wardrive/coverage/CoverageMap';
import type { QueryParams } from '../../../wardrive/coverage/state';
import type { CellsPage, MapCell, MapDriver, PointsPage } from '../../../wardrive/coverage/types';
import { point } from './fixtures';

const NOW = new Date(2026, 9, 20, 15, 0, 0).getTime();
const now = () => NOW;

const CELL: MapCell = {
  cell: '9:1:2',
  best: -72,
  count: 4,
  drivers: 2,
  ring: [
    [5, 52],
    [5.1, 52],
    [5.1, 52.1],
    [5, 52],
  ],
};
const DRIVERS: MapDriver[] = [
  {
    user_id: 1,
    username: 'anna',
    count: 3,
    last_ts: 100,
    last_rx_at: 'x',
    last_lat: 52.3,
    last_lon: 5.3,
  },
  {
    user_id: 2,
    username: 'bert',
    count: 1,
    last_ts: 50,
    last_rx_at: 'y',
    last_lat: 51,
    last_lon: 4,
  },
];

const NODE_KEY = ('c3d4' + 'ab'.repeat(32)).slice(0, 64);
const NODES = [
  { public_key: NODE_KEY, name: 'Toren', role: 'Repeater', lat: 52.5, lon: 5.5, seen: 1 },
];

function fakeApi(over: Partial<CoverageApi> = {}) {
  const points = vi.fn((): Promise<PointsPage> =>
    Promise.resolve({
      points: [
        point(),
        point({ name: 'Mast', sender: { kind: 'path_hash', id: 'b2', label: 'b2', role: null } }),
      ],
      truncated: false,
      covers_from: null,
    })
  );
  const cells = vi.fn((): Promise<CellsPage> =>
    Promise.resolve({ cells: [CELL], truncated: false, covers_from: null })
  );
  const drivers = vi.fn(() => Promise.resolve({ drivers: DRIVERS }));
  const nodes = vi.fn(() => Promise.resolve({ nodes: NODES, truncated: false }));
  return { nodes, points, cells, drivers, ...over } as unknown as CoverageApi & {
    points: ReturnType<typeof vi.fn>;
    cells: ReturnType<typeof vi.fn>;
    drivers: ReturnType<typeof vi.fn>;
    nodes: ReturnType<typeof vi.fn>;
  };
}

function url(initial = '') {
  let params = new URLSearchParams(initial);
  return {
    read: () => params,
    write: vi.fn((p: URLSearchParams) => {
      params = p;
    }),
  };
}

const VIEW = {
  bbox: [52, 5, 53, 6] as [number, number, number, number],
  lat: 52.5,
  lon: 5.5,
  pitch: 0,
  bearing: 0,
};

async function mount(api: CoverageApi, initial = '', z = 12) {
  const state = url(initial);
  render(
    <CoverageMap
      api={api}
      urlState={state}
      debounceMs={0}
      now={now}
      storeKey="test-cov"
      showIntro={false}
    />
  );
  await act(async () => gl.onView({ ...VIEW, z }));
  return state;
}

const lastParams = (fn: ReturnType<typeof vi.fn>): QueryParams =>
  fn.mock.calls.slice(-1)[0]![0] as QueryParams;

beforeEach(() => {
  localStorage.clear();
});

describe('coverage map', () => {
  it('asks for the cells of both sizes in view, with the filters from the URL', async () => {
    const api = fakeApi();
    await mount(api, 'types=Advert&lat=52.5&lon=5.5&z=12');
    await waitFor(() => expect(api.cells).toHaveBeenCalledTimes(2));
    expect(api.cells.mock.calls.map((c) => c[1] as number).sort((a, b) => a - b)).toEqual([9, 10]);
    expect(lastParams(api.cells)).toMatchObject({ types: 'Advert', bbox: '52,5,53,6' });
    expect(api.points).not.toHaveBeenCalled();
    await waitFor(() => expect(gl.cells.b).toEqual([CELL]));
    expect(screen.getByRole('status')).toHaveTextContent('1 cell');
  });

  it('keeps the newest answer when an older one lands later', async () => {
    let releaseOld!: (v: CellsPage) => void;
    const old = new Promise<CellsPage>((r) => (releaseOld = r));
    const NEW_CELL = { ...CELL, cell: '9:9:9' };
    const cells = vi
      .fn()
      .mockReturnValueOnce(old)
      .mockReturnValueOnce(old)
      .mockResolvedValue({ cells: [NEW_CELL], truncated: false, covers_from: null });
    const api = fakeApi({ cells });
    await mount(api);
    await act(async () => gl.onView({ ...VIEW, bbox: [52.1, 5, 53, 6], z: 12.1 }));
    await waitFor(() => expect(gl.cells.b).toEqual([NEW_CELL]));
    await act(async () => releaseOld({ cells: [CELL], truncated: false, covers_from: null }));
    expect(gl.cells.b).toEqual([NEW_CELL]);
  });

  it('says a load failed and leaves the map empty', async () => {
    const api = fakeApi({ cells: vi.fn().mockRejectedValue(new Error('boom')) });
    await mount(api);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('boom'));
    expect(gl.cells.a).toEqual([]);
    expect(gl.cells.b).toEqual([]);
  });

  it('loads the points in the Points mode and opens a reception', async () => {
    const api = fakeApi();
    await mount(api, 'mode=points');
    await waitFor(() => expect(gl.points).toHaveLength(2));
    expect(screen.getByRole('status')).toHaveTextContent('2 points');
    act(() => gl.onPickPoint(0));
    const card = screen.getByRole('dialog', { name: /Toren/ });
    expect(within(card).getByText(/anna/)).toBeInTheDocument();
    expect(gl.selected).toEqual(point());
  });

  it('ignores a sender from the reception card', async () => {
    const api = fakeApi();
    await mount(api, 'mode=points');
    await waitFor(() => expect(gl.points).toHaveLength(2));
    act(() => gl.onPickPoint(0));
    fireEvent.click(screen.getByRole('button', { name: 'Ignore this ID' }));
    await waitFor(() => expect(lastParams(api.points).ignore).toEqual(['c3d4']));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 ignored'));
  });

  it('narrows to one driver, fits the map to them and pins their newest position', async () => {
    const api = fakeApi();
    await mount(api);
    fireEvent.click(screen.getByRole('button', { name: /All drivers/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /anna/ }));
    await waitFor(() => expect(lastParams(api.cells).users).toBe('1'));
    await waitFor(() => expect(gl.fit).not.toBeNull());
    expect(gl.pin).toEqual({ lat: 52.3, lon: 5.3, label: 'anna' });
  });

  it('switches the layer mode and writes it to the URL', async () => {
    const api = fakeApi();
    const state = await mount(api);
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Points' }));
    await waitFor(() => expect(state.read().get('mode')).toBe('points'));
    expect(gl.mode).toBe('points');
  });

  it('clears the filters', async () => {
    const api = fakeApi();
    await mount(api, 'types=Advert&nopath=1');
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastParams(api.cells).types).toBeUndefined());
    expect(lastParams(api.cells).nopath).toBeUndefined();
  });

  it('picks a quick range', async () => {
    const api = fakeApi();
    await mount(api);
    fireEvent.click(screen.getByRole('button', { name: /Last 30 days/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() =>
      expect(lastParams(api.cells).since).toBe(String(Math.floor(NOW / 1000) - 7 * 86400))
    );
  });

  it('copies a link with the range frozen to fixed times', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const api = fakeApi();
    await mount(api);
    fireEvent.click(screen.getByRole('button', { name: /Last 30 days/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy absolute link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = new URL(writeText.mock.calls[0][0] as string);
    const params = new URLSearchParams(copied.hash.split('?')[1] ?? copied.search);
    expect(params.get('from')).toMatch(/^2026-09-20T15:00/);
    expect(params.get('to')).toMatch(/^2026-10-20T15:00/);
  });

  it('picks a target sender', async () => {
    const api = fakeApi();
    await mount(api);
    fireEvent.click(screen.getByRole('button', { name: /Select target/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Toren/ }));
    await waitFor(() => expect(lastParams(api.cells).sender).toEqual(['c3d4']));
  });

  it('sends the surface own extra filters with every call', async () => {
    const api = fakeApi();
    const state = url('lat=52.5&lon=5.5&z=12');
    render(
      <CoverageMap
        api={api}
        urlState={state}
        debounceMs={0}
        now={now}
        storeKey="test-cov"
        extraParams={{ group_id: '5', radio_key: 'AB' }}
      />
    );
    await act(async () => gl.onView({ ...VIEW, z: 12 }));
    await waitFor(() => expect(api.cells).toHaveBeenCalled());
    expect(lastParams(api.cells)).toMatchObject({ group_id: '5', radio_key: 'AB' });
    expect(lastParams(api.drivers)).toMatchObject({ group_id: '5', radio_key: 'AB' });
  });

  it('steps through node positions and draws the nodes RTFM-EV knows', async () => {
    const api = fakeApi();
    await mount(api, 'lat=52.5&lon=5.5&z=12');
    fireEvent.click(screen.getByRole('button', { name: 'Node positions: off' }));
    await waitFor(() => expect(gl.overlays?.nodes?.advertised.features).toHaveLength(1));
    const box = api.nodes.mock.calls[0][0] as { south: number; north: number };
    expect(box.south).toBeLessThan(52);
    expect(box.north).toBeGreaterThan(53);
    expect(gl.overlays?.reach).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Node positions: on' }));
    await waitFor(() => expect(gl.overlays?.reach).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /every repeater/ }));
    await waitFor(() => expect(gl.overlays?.nodes).toBeNull());
  });

  it('asks to zoom in when the view is too big for the node list', async () => {
    const api = fakeApi();
    await mount(api, 'lat=50&lon=10&z=5');
    await act(async () => gl.onView({ ...VIEW, bbox: [40, 0, 60, 20], z: 5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Node positions: off' }));
    expect(await screen.findByText('Zoom in to see node positions.')).toBeInTheDocument();
    expect(api.nodes).not.toHaveBeenCalled();
  });

  it('opens a node and selects its reach in the reach stop', async () => {
    const api = fakeApi();
    await mount(api, 'lat=52.5&lon=5.5&z=12&nodepos=reach');
    await waitFor(() => expect(gl.overlays?.nodes?.advertised.features).toHaveLength(1));
    act(() => gl.onPickNode?.(NODE_KEY));
    const card = await screen.findByRole('dialog', { name: 'Toren' });
    fireEvent.click(within(card).getByRole('button', { name: 'Hide reach' }));
    expect(within(card).getByRole('button', { name: 'Show reach' })).toBeInTheDocument();
  });

  it('locates a sender from its reception card and leaves Locate again', async () => {
    const api = fakeApi();
    await mount(api, 'lat=52.5&lon=5.5&z=12&mode=points&types=GroupText');
    await waitFor(() => expect(gl.points).toHaveLength(2));
    act(() => gl.onPickPoint(0));
    fireEvent.click(screen.getByRole('button', { name: 'Locate this sender' }));
    await waitFor(() => expect(gl.overlays?.locate).not.toBeNull());
    const asked = lastParams(api.points);
    expect(asked.sender).toEqual(['c3d4']);
    expect(asked.bbox).toBeUndefined();
    expect(asked.types).toBeUndefined();
    // Both fixture points stand on one spot: the 10 m dedupe keeps one.
    expect(await screen.findByText('1 point: too few to estimate (3 needed).')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave Locate' }));
    await waitFor(() => expect(gl.overlays?.locate).toBeNull());
  });

  it('lists the newest receptions of the window', async () => {
    const api = fakeApi();
    await mount(api, 'lat=52.5&lon=5.5&z=12');
    fireEvent.click(screen.getByRole('button', { name: 'Receptions' }));
    const list = await screen.findByRole('region', { name: 'Receptions' });
    await waitFor(() =>
      expect(within(list).getAllByRole('button', { name: /Toren|Mast/ })).toHaveLength(2)
    );
    const asked = api.points.mock.calls
      .map((c) => c[0] as QueryParams)
      .find((p) => p.limit === '200');
    expect(asked).toMatchObject({ offset: '0' });
    expect(asked?.bbox).toBeUndefined();
    expect(within(list).getByText('2 receptions')).toBeInTheDocument();
  });

  it('opens a listed reception on the map and flies there when it is off screen', async () => {
    const far = point({ lat: 51, lon: 4, name: 'Ver', hash: 'ff' });
    const api = fakeApi({
      points: vi
        .fn()
        .mockResolvedValue({ points: [point(), far], truncated: false, covers_from: null }),
    });
    await mount(api, 'lat=52.5&lon=5.5&z=12');
    fireEvent.click(screen.getByRole('button', { name: 'Receptions' }));
    const list = await screen.findByRole('region', { name: 'Receptions' });
    fireEvent.click(await within(list).findByRole('button', { name: /Ver/ }));
    expect(gl.selected).toEqual(far);
    expect(gl.focus).toMatchObject({ lat: 51, lon: 4 });
    expect(screen.getByRole('dialog', { name: 'Ver' })).toBeInTheDocument();
  });

  it('marks the newest listed reception of a tapped cell', async () => {
    const inside = point({ lat: 52.03, lon: 5.07, name: 'Binnen', hash: 'aa' });
    const api = fakeApi({
      points: vi
        .fn()
        .mockResolvedValue({ points: [inside, point()], truncated: false, covers_from: null }),
    });
    await mount(api, 'lat=52.5&lon=5.5&z=12');
    fireEvent.click(screen.getByRole('button', { name: 'Receptions' }));
    const list = await screen.findByRole('region', { name: 'Receptions' });
    await within(list).findByRole('button', { name: /Binnen/ });
    act(() => gl.onPickCell(CELL));
    expect(within(list).getByRole('button', { name: /Binnen/ })).toHaveAttribute(
      'aria-current',
      'true'
    );
  });

  it('exports the repeaters heard in view as a share card', async () => {
    const near = (lat: number, lon: number, rssi: number) =>
      point({
        lat,
        lon,
        rssi,
        hash: `${lat}`,
        sender: { kind: 'relay', id: 'c3d4', label: null, role: null },
      });
    const api = fakeApi({
      points: vi.fn().mockResolvedValue({
        points: [near(52.51, 5.51, -80), near(52.49, 5.52, -90), near(52.52, 5.48, -95)],
        truncated: false,
        covers_from: null,
      }),
    });
    await mount(api, 'lat=52.5&lon=5.5&z=12');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByTestId('share-dialog')).toHaveTextContent('Repeaters heard');
    expect(dialog?.framing?.located.length).toBeGreaterThan(0);
  });

  it('says when no repeater was heard in view', async () => {
    const api = fakeApi();
    await mount(api, 'lat=52.5&lon=5.5&z=12');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(
      await screen.findByText(
        'No repeater was heard in this view. Pan to where you drove, or widen the time range.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId('share-dialog')).toBeNull();
  });

  it('shows how the map works the first time only', async () => {
    const first = render(
      <CoverageMap api={fakeApi()} urlState={url()} debounceMs={0} now={now} storeKey="intro" />
    );
    const intro = await screen.findByRole('dialog', { name: 'The coverage map' });
    fireEvent.click(within(intro).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog', { name: 'The coverage map' })).toBeNull();
    first.unmount();
    render(
      <CoverageMap api={fakeApi()} urlState={url()} debounceMs={0} now={now} storeKey="intro" />
    );
    expect(screen.queryByRole('dialog', { name: 'The coverage map' })).toBeNull();
  });

  it('has map settings: terrain, the ignore list and the walkthrough', async () => {
    const api = fakeApi();
    await mount(api, 'lat=52.5&lon=5.5&z=12&view=3d');
    fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
    fireEvent.change(screen.getByLabelText('Terrain exaggeration'), { target: { value: '2' } });
    expect(gl.exaggeration).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'How the map works' }));
    expect(await screen.findByRole('dialog', { name: 'The coverage map' })).toBeInTheDocument();
  });
});
