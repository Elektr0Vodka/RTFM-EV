import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegionsPane } from '../components/repeater/RepeaterRegionsPane';
import type { RepeaterRegionsResponse, PaneState } from '../types';

const state: PaneState = { loading: false, attempt: 1, error: null };

const data: RepeaterRegionsResponse = {
  regions: [
    { name: '*', depth: 0, flood_allowed: true, is_home: false },
    { name: 'nl', depth: 1, flood_allowed: true, is_home: true },
    { name: 'eu', depth: 1, flood_allowed: true, is_home: false },
  ],
  source: 'cli',
  truncated: false,
  raw: '* F\n nl^ F\n eu F\n',
};

describe('RegionsPane seed-to-known-regions', () => {
  it('passes the named region codes (wildcard excluded) to onSeedKnownRegions', async () => {
    const onSeed = vi.fn().mockResolvedValue(2);
    render(
      <RegionsPane data={data} state={state} onRefresh={() => {}} onSeedKnownRegions={onSeed} />
    );
    fireEvent.click(screen.getByRole('button', { name: /add to known regions/i }));
    await waitFor(() => expect(onSeed).toHaveBeenCalledWith(['nl', 'eu']));
  });

  it('does not render the seed button when no seed handler is provided', () => {
    render(<RegionsPane data={data} state={state} onRefresh={() => {}} />);
    expect(screen.queryByRole('button', { name: /add to known regions/i })).toBeNull();
  });

  it('does not render the seed button when only the wildcard is reported', () => {
    const wildcardOnly: RepeaterRegionsResponse = {
      regions: [{ name: '*', depth: 0, flood_allowed: true, is_home: false }],
      source: 'cli',
      truncated: false,
      raw: '* F\n',
    };
    render(
      <RegionsPane
        data={wildcardOnly}
        state={state}
        onRefresh={() => {}}
        onSeedKnownRegions={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /add to known regions/i })).toBeNull();
  });
});
