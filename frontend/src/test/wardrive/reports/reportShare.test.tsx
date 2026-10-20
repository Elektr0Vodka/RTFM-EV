import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderReportCard = vi.fn();
vi.mock('../../../wardrive/reports/cards', async (orig) => ({
  ...(await orig<typeof import('../../../wardrive/reports/cards')>()),
  renderReportCard: (...args: unknown[]) => renderReportCard(...args),
}));

import { I18nProvider } from '../../../i18n';
import { ReportShare } from '../../../wardrive/reports/ReportShare';
import { emptyReport, report } from './fixtures';

const brand = vi.fn(async () => ({ name: 'RTFM-EV', icon: null }));

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:card');
  URL.revokeObjectURL = vi.fn();
  renderReportCard.mockResolvedValue({ png: new Blob(['png'], { type: 'image/png' }) });
});

describe('report share buttons', () => {
  it('offers the three cards and builds one with its figures', async () => {
    render(
      <I18nProvider>
        <ReportShare report={report()} brand={brand} />
      </I18nProvider>
    );
    expect(screen.getByRole('button', { name: 'Drive card' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coverage card' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Weak spots card' }));
    await waitFor(() => expect(renderReportCard).toHaveBeenCalled());
    const [kind, , text] = renderReportCard.mock.calls[0];
    expect(kind).toBe('weak');
    expect(text.figures.map((f: { value: string }) => f.value)).toEqual(
      expect.arrayContaining(['19', '6'])
    );
    expect(brand).toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Hide my position');
  });

  it('gives the drive card its five figures, nodes heard among them', async () => {
    render(
      <I18nProvider>
        <ReportShare report={report()} brand={brand} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Drive card' }));
    await waitFor(() => expect(renderReportCard).toHaveBeenCalled());
    const [, , text] = renderReportCard.mock.calls[0];
    expect(text.figures.map((f: { label: string }) => f.label)).toEqual([
      'driven',
      'on the road',
      'receptions',
      'nodes heard',
      'best signal',
    ]);
    expect(text.figures[3].value).toBe('2');
  });

  it('gives the weak spots card the time in every weak cell and the best node nearby', async () => {
    render(
      <I18nProvider>
        <ReportShare report={report()} brand={brand} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Weak spots card' }));
    await waitFor(() => expect(renderReportCard).toHaveBeenCalled());
    const [, , text] = renderReportCard.mock.calls[0];
    const figures = text.figures as { value: string; label: string }[];
    expect(figures.map((f) => f.label)).toEqual([
      'gaps',
      'weak cells',
      'time in them',
      'best node nearby',
    ]);
    // weak_spots.track_s (4500 s), not the listed cells' 600 s.
    expect(figures[2].value).toBe('1 h 15 min');
    expect(figures[3].value).toBe('~Toren');
  });

  it('lets the driver frame the map of a card and builds with that view', async () => {
    render(
      <I18nProvider>
        <ReportShare report={report()} brand={brand} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coverage card' }));
    expect(await screen.findByRole('button', { name: 'Frame the map' })).toBeTruthy();
    await waitFor(() => expect(renderReportCard).toHaveBeenCalled());
    const [, , , , opts] = renderReportCard.mock.calls[0];
    expect(opts).toMatchObject({ view: null });
  });

  it('turns cards off when there is nothing to draw', () => {
    render(
      <I18nProvider>
        <ReportShare report={emptyReport()} brand={brand} />
      </I18nProvider>
    );
    for (const name of ['Drive card', 'Coverage card', 'Weak spots card']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
