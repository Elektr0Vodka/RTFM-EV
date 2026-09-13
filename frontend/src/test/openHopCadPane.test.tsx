import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenHopCadPane } from '../components/settings/openhop/cad/OpenHopCadPane';
import { api } from '../api';

class MockEventSource {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {}
  close() {}
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('OpenHopCadPane', () => {
  it('runs a manual check and shows detection metrics', async () => {
    vi.spyOn(api, 'openHopCadManualCheck').mockResolvedValue({
      success: true,
      data: { attempts: 4, detections: 1, detection_rate: 0.25, detected: true },
    });
    render(<OpenHopCadPane />);
    await userEvent.click(screen.getByRole('button', { name: /manual check/i }));
    await waitFor(() => expect(screen.getByText(/1 \/ 4/)).toBeInTheDocument());
    expect(screen.getByText(/25%/)).toBeInTheDocument();
  });

  it('requires confirm before saving CAD settings', async () => {
    const save = vi.spyOn(api, 'openHopCadSave').mockResolvedValue({ success: true });
    render(<OpenHopCadPane />);
    // The save button appears twice (section header trigger + confirm); click the first.
    await userEvent.click(screen.getAllByRole('button', { name: /save/i })[0]);
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByRole('button', { name: /save/i })[1]);
    await waitFor(() => expect(save).toHaveBeenCalledWith(127, 64, 2));
  });
});
