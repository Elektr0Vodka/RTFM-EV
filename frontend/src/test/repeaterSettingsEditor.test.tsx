import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { I18nProvider } from '../i18n/I18nProvider';
import {
  SettingsEditorPane,
  type SettingsEditorSeed,
} from '../components/repeater/RepeaterSettingsEditorPane';
import {
  SETTING_DEFS,
  validateSetting,
  type SettingDef,
} from '../components/repeater/repeaterSettingsDefs';
import { applyReadbackToPaneData, type PaneData } from '../hooks/useRepeaterDashboard';
import type { RepeaterSettingSetResponse } from '../types';

const def = (key: string): SettingDef => SETTING_DEFS.find((d) => d.key === key)!;

const seed: SettingsEditorSeed = {
  radioSettings: {
    firmware_version: 'v1.15.0',
    radio: '869.5250244,250.0,11,5',
    tx_power: '14',
    airtime_factor: '1.0',
    duty_cycle_limit: '50.0%',
    repeat_enabled: 'on',
    flood_max: '8',
  },
  advertIntervals: { advert_interval: '120', flood_advert_interval: '12' },
  nodeInfo: { name: 'Hill Rptr', lat: '52.1', lon: '4.5', clock_utc: null },
  ownerInfo: null,
};

function okResult(setting: string, value: string, extra: Partial<RepeaterSettingSetResponse> = {}) {
  return {
    setting,
    value,
    set_reply: 'OK',
    readback: value,
    status: 'ok',
    reboot_required: false,
    ...extra,
  } as RepeaterSettingSetResponse;
}

function renderPane(onApply = vi.fn(), onRead = vi.fn().mockResolvedValue({ values: {} })) {
  render(
    <I18nProvider>
      <SettingsEditorPane
        seed={seed}
        repeaterName="Hill Rptr"
        confirmPhrase="Hill Rptr"
        onRead={onRead}
        onApply={onApply}
      />
    </I18nProvider>
  );
  return { onApply, onRead };
}

function openEditor(key: string) {
  const row = screen.getByTestId(`setting-row-${key}`);
  fireEvent.click(within(row).getByRole('button'));
  return screen.getByRole('dialog');
}

describe('validateSetting (client mirror of the server allow-list)', () => {
  it('has no prv.key entry', () => {
    expect(SETTING_DEFS.some((d) => d.key.includes('prv'))).toBe(false);
  });

  it.each([
    ['tx', '20', '20'],
    ['tx', '-9', '-9'],
    ['txdelay', '0.500', '0.5'],
    ['advert.interval', '0', '0'],
    ['advert.interval', '120', '120'],
    ['agc.reset.interval', '8', '8'],
    ['owner.info', 'a\nb', 'a|b'],
    ['radio', '869.525,62.50,8,8', '869.525,62.5,8,8'],
  ])('accepts %s=%s', (key, raw, expected) => {
    expect(validateSetting(def(key), raw)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['tx', '31'],
    ['tx', '1.5'],
    ['flood.max', '65'],
    ['advert.interval', '61'],
    ['advert.interval', '30'],
    ['agc.reset.interval', '10'],
    ['dutycycle', '0'],
    ['lat', '91'],
    ['name', 'a,b'],
    ['name', ' padded'],
    ['guest.password', 'x'.repeat(16)],
    ['radio', '869.525,200,8,8'],
    ['radio', '100,250,8,8'],
    ['radio', '869.525,250,13,8'],
  ])('rejects %s=%s', (key, raw) => {
    expect(validateSetting(def(key), raw).ok).toBe(false);
  });
});

describe('applyReadbackToPaneData', () => {
  it('mirrors tx into the radio settings pane and leaves other panes alone', () => {
    const data = { ...seed, status: null, neighbors: null, acl: null } as unknown as PaneData;
    const next = applyReadbackToPaneData(data, 'tx', '20');
    expect(next.radioSettings?.tx_power).toBe('20');
    expect(next.nodeInfo).toBe(data.nodeInfo);
  });

  it('is a no-op when the matching pane was never fetched', () => {
    const data = { radioSettings: null } as unknown as PaneData;
    expect(applyReadbackToPaneData(data, 'tx', '20')).toBe(data);
  });
});

describe('SettingsEditorPane', () => {
  it('seeds current values from the read-only panes', () => {
    renderPane();
    expect(within(screen.getByTestId('setting-row-tx')).getByText('14')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('setting-row-radio')).getByText(
        '869.525 MHz, BW 250 kHz, SF11, CR5'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('setting-row-loop.detect')).getByText('not read')
    ).toBeInTheDocument();
  });

  it('blocks an out-of-range value before the confirm step', () => {
    const { onApply } = renderPane();
    const dialog = openEditor('tx');
    fireEvent.change(within(dialog).getByLabelText('New value'), { target: { value: '99' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Between -9 and 30');
    expect(within(dialog).queryByTestId('confirm-command')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('confirms old and new value, then sends one set and shows the read-back', async () => {
    const onApply = vi.fn().mockResolvedValue(okResult('tx', '20'));
    renderPane(onApply);
    const dialog = openEditor('tx');
    fireEvent.change(within(dialog).getByLabelText('New value'), { target: { value: '20' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));

    expect(within(dialog).getByTestId('confirm-old')).toHaveTextContent('14');
    expect(within(dialog).getByTestId('confirm-new')).toHaveTextContent('20');
    expect(within(dialog).getByTestId('confirm-command')).toHaveTextContent('set tx 20');
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to repeater' }));
    await waitFor(() => expect(screen.getByTestId('setting-result')).toBeInTheDocument());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('tx', '20');
    expect(screen.getByTestId('setting-result')).toHaveTextContent('Applied. Read back: 20');

    fireEvent.click(
      within(screen.getByTestId('setting-result')).getByRole('button', { name: 'Close' })
    );
    const row = screen.getByTestId('setting-row-tx');
    expect(within(row).getByText('20')).toBeInTheDocument();
    expect(within(row).getByTestId('setting-status')).toHaveTextContent('verified');
  });

  it('Back and Cancel never send', () => {
    const { onApply } = renderPane();
    const dialog = openEditor('flood.max');
    fireEvent.change(within(dialog).getByLabelText('New value'), { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refuses an unchanged value', () => {
    const { onApply } = renderPane();
    const dialog = openEditor('flood.max');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('same as the current value');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows a read-back mismatch clearly', async () => {
    const onApply = vi
      .fn()
      .mockResolvedValue(okResult('flood.max', '4', { readback: '8', status: 'mismatch' }));
    renderPane(onApply);
    const dialog = openEditor('flood.max');
    fireEvent.change(within(dialog).getByLabelText('New value'), { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to repeater' }));
    await waitFor(() => expect(screen.getByTestId('setting-result')).toBeInTheDocument());
    expect(screen.getByTestId('setting-result')).toHaveTextContent(
      'Read-back mismatch: expected 4, the repeater reports 8'
    );
  });

  it('reports an unverified (timed out) read-back without changing the row value', async () => {
    const onApply = vi
      .fn()
      .mockResolvedValue(
        okResult('flood.max', '4', { set_reply: null, readback: null, status: 'unverified' })
      );
    renderPane(onApply);
    const dialog = openEditor('flood.max');
    fireEvent.change(within(dialog).getByLabelText('New value'), { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to repeater' }));
    await waitFor(() => expect(screen.getByTestId('setting-result')).toBeInTheDocument());
    expect(screen.getByTestId('setting-result')).toHaveTextContent('No read-back heard');
    fireEvent.click(
      within(screen.getByTestId('setting-result')).getByRole('button', { name: 'Close' })
    );
    const row = screen.getByTestId('setting-row-flood.max');
    expect(within(row).getByText('8')).toBeInTheDocument();
    expect(within(row).getByTestId('setting-status')).toHaveTextContent('unverified');
  });

  it('shows a request failure (e.g. no radio) as an error', async () => {
    const onApply = vi.fn().mockRejectedValue(new Error('Radio not connected'));
    renderPane(onApply);
    const dialog = openEditor('flood.max');
    fireEvent.change(within(dialog).getByLabelText('New value'), { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to repeater' }));
    await waitFor(() => expect(screen.getByTestId('setting-result')).toBeInTheDocument());
    expect(screen.getByTestId('setting-result')).toHaveTextContent(
      'Request failed: Radio not connected'
    );
  });

  it('radio needs the typed repeater name and warns about stranding + reboot', async () => {
    const onApply = vi.fn().mockResolvedValue(
      okResult('radio', '869.618,62.5,8,8', {
        set_reply: 'OK - reboot to apply',
        readback: '869.6179810,62.5,8,8',
        reboot_required: true,
      })
    );
    renderPane(onApply);
    const dialog = openEditor('radio');
    fireEvent.change(within(dialog).getByLabelText('Frequency (MHz)'), {
      target: { value: '869.618' },
    });
    fireEvent.change(within(dialog).getByLabelText('Bandwidth (kHz)'), {
      target: { value: '62.5' },
    });
    fireEvent.change(within(dialog).getByLabelText('Spreading factor'), {
      target: { value: '8' },
    });
    fireEvent.change(within(dialog).getByLabelText('Coding rate'), { target: { value: '8' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));

    expect(within(dialog).getByText('Danger: radio parameters')).toBeInTheDocument();
    expect(within(dialog).getByText(/strands the repeater off-air/)).toBeInTheDocument();
    expect(within(dialog).getByText(/only after a reboot/)).toBeInTheDocument();
    expect(within(dialog).getByTestId('confirm-command')).toHaveTextContent(
      'set radio 869.618,62.5,8,8'
    );

    const send = within(dialog).getByRole('button', { name: 'Send to repeater' });
    expect(send).toBeDisabled();
    const phrase = within(dialog).getByLabelText('Type Hill Rptr to confirm');
    fireEvent.change(phrase, { target: { value: 'hill rptr' } });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.change(phrase, { target: { value: 'Hill Rptr' } });
    expect(send).not.toBeDisabled();
    fireEvent.click(send);
    await waitFor(() => expect(screen.getByTestId('setting-result')).toBeInTheDocument());
    expect(onApply).toHaveBeenCalledWith('radio', '869.618,62.5,8,8');
    expect(screen.getByTestId('setting-result')).toHaveTextContent(
      'Reboot the repeater to apply the new radio settings.'
    );
  });

  it('non-radio settings do not ask for the typed phrase', () => {
    renderPane();
    const dialog = openEditor('repeat');
    fireEvent.change(within(dialog).getByLabelText('New value'), { target: { value: 'off' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review change' }));
    expect(within(dialog).queryByLabelText(/to confirm/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Send to repeater' })).not.toBeDisabled();
  });

  it('Read current values fills unread rows', async () => {
    const onRead = vi.fn().mockResolvedValue({ values: { 'loop.detect': 'moderate' } });
    renderPane(vi.fn(), onRead);
    fireEvent.click(screen.getByRole('button', { name: 'Read current values' }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('setting-row-loop.detect')).getByText('Moderate')
      ).toBeInTheDocument()
    );
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('keeps radio locked until its current value is read (no guessed defaults)', async () => {
    const onRead = vi.fn().mockResolvedValue({ values: { radio: '869.618,62.5,8,8' } });
    render(
      <I18nProvider>
        <SettingsEditorPane
          seed={{ ...seed, radioSettings: null }}
          repeaterName="Hill Rptr"
          confirmPhrase="Hill Rptr"
          onRead={onRead}
          onApply={vi.fn()}
        />
      </I18nProvider>
    );
    const radioEdit = within(screen.getByTestId('setting-row-radio')).getByRole('button');
    expect(radioEdit).toBeDisabled();
    // Other settings stay editable without a read.
    expect(within(screen.getByTestId('setting-row-tx')).getByRole('button')).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Read current values' }));
    await waitFor(() => expect(radioEdit).not.toBeDisabled());
    fireEvent.click(radioEdit);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Frequency (MHz)')).toHaveValue('869.618');
    expect(within(dialog).getByLabelText('Bandwidth (kHz)')).toHaveValue('62.5');
  });
});
