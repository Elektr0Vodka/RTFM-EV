import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SettingsDatabaseSection } from '../components/settings/SettingsDatabaseSection';

function makeSettings(overrides = {}) {
  return {
    // Minimal AppSettings covering the fields the component reads on mount.
    auto_decrypt_dm_on_advert: false,
    registry_sync_url: '',
    wordlist_sync_url: '',
    analyzer_sites: [],
    advert_retention_days: 30,
    ...overrides,
  } as never;
}

describe('Database settings advert retention', () => {
  it('renders the retention input with the current value', () => {
    render(
      <SettingsDatabaseSection
        appSettings={makeSettings()}
        health={null}
        onSaveAppSettings={vi.fn().mockResolvedValue(undefined)}
        onHealthRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const input = screen.getByLabelText('Keep advert history (days)') as HTMLInputElement;
    expect(input.value).toBe('30');
  });

  it('persists a changed value on blur', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsDatabaseSection
        appSettings={makeSettings()}
        health={null}
        onSaveAppSettings={onSave}
        onHealthRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const input = screen.getByLabelText('Keep advert history (days)');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ advert_retention_days: 7 }));
  });
});
