import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '../../../i18n';
import { DISTANCE_UNIT_KEY } from '../../../utils/distanceUnits';
import { ReportPanel } from '../../../wardrive/reports/ReportPanel';
import type { DrivesApi } from '../../../wardrive/reports/types';
import { emptyReport, fakeApi, report } from './fixtures';

function renderPanel(api: DrivesApi) {
  render(
    <I18nProvider>
      <ReportPanel api={api} query={{ drive: [1] }} />
    </I18nProvider>
  );
}

beforeEach(() => {
  localStorage.setItem(DISTANCE_UNIT_KEY, 'metric');
});

describe('report panel', () => {
  it('shows the four sections with their numbers', async () => {
    renderPanel(fakeApi());
    const summary = (await screen.findByRole('heading', { name: 'What was driven' })).closest(
      'section'
    )!;
    expect(within(summary).getByText('12.3km')).toBeTruthy();
    expect(within(summary).getByText('1 h 5 min')).toBeTruthy();
    expect(within(summary).getByText('-95 dBm')).toBeTruthy();
    const coverage = screen
      .getByRole('heading', { name: 'How well the area is covered' })
      .closest('section')!;
    expect(within(coverage).getByText('62 %')).toBeTruthy();
    const weak = screen
      .getByRole('heading', { name: 'Where coverage is weak or missing' })
      .closest('section')!;
    expect(within(weak).getByText('19')).toBeTruthy();
    expect(within(weak).getByText(/~Toren -101 dBm/)).toBeTruthy();
    // The cell list pairs a node with its own best signal, not the cell's.
    expect(within(coverage).getAllByText('-85 dBm via ~Toren').length).toBeGreaterThan(0);
    const nodes = screen
      .getByRole('heading', { name: 'Which nodes are heard where, and how well' })
      .closest('section')!;
    expect(within(nodes).getByText('~Toren')).toBeTruthy();
    expect(within(nodes).getByText('a1b2c3')).toBeTruthy();
  });

  it('says when the selection holds nothing', async () => {
    renderPanel(fakeApi([], emptyReport()));
    expect(await screen.findByText('No receptions in this selection.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'What was driven' })).toBeNull();
  });

  it('loads again with a finer cell size', async () => {
    const api = fakeApi();
    renderPanel(api);
    await screen.findByRole('heading', { name: 'What was driven' });
    fireEvent.change(screen.getByLabelText('Cell size'), { target: { value: '11' } });
    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith({ drive: [1], res: 11 }));
  });

  it('downloads each export for the same selection', async () => {
    const api = fakeApi();
    renderPanel(api);
    await screen.findByRole('heading', { name: 'What was driven' });
    fireEvent.click(screen.getByRole('button', { name: 'Receptions (CSV)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Track (GPX)' }));
    await waitFor(() => expect(api.download).toHaveBeenCalledTimes(2));
    expect(api.download).toHaveBeenNthCalledWith(1, 'receptions.csv', { drive: [1], res: 9 });
    expect(api.download).toHaveBeenNthCalledWith(2, 'drives.gpx', { drive: [1], res: 9 });
  });

  it('says when the report was cut short', async () => {
    renderPanel(fakeApi(undefined, report({ truncated: true })));
    expect(await screen.findByText(/newest 200,000/)).toBeTruthy();
  });

  it('shows the server message when the report fails', async () => {
    const api = fakeApi();
    api.report.mockRejectedValueOnce(new Error('No such drive'));
    renderPanel(api);
    expect(await screen.findByText('No such drive')).toBeTruthy();
  });
});
