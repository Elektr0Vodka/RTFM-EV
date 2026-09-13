import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsDatabaseSection } from '../components/settings/SettingsDatabaseSection';
import { api } from '../api';
import type { AppSettings } from '../types';

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    auto_decrypt_dm_on_advert: false,
    advert_retention_days: 30,
    registry_sync_url: '',
    wordlist_sync_url: '',
    analyzer_sites: [],
    backup_to_path_enabled: false,
    backup_destination_path: '',
    ...overrides,
  } as AppSettings;
}

afterEach(() => vi.restoreAllMocks());

describe('SettingsDatabaseSection backup', () => {
  it('renders a download link pointing at the backup endpoint', () => {
    render(
      <SettingsDatabaseSection
        appSettings={baseSettings()}
        health={null}
        onSaveAppSettings={vi.fn().mockResolvedValue(undefined)}
        onHealthRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const link = screen.getByRole('link', { name: /download backup/i });
    expect(link.getAttribute('href')).toBe(api.downloadBackupUrl());
  });

  it('calls saveBackup when the server button is clicked (toggle on + path set)', () => {
    const saveSpy = vi.spyOn(api, 'saveBackup').mockResolvedValue({
      path: '/mnt/b/x.db',
      size_bytes: 10,
      timestamp: 't',
    });
    render(
      <SettingsDatabaseSection
        appSettings={baseSettings({
          backup_to_path_enabled: true,
          backup_destination_path: '/mnt/b',
        })}
        health={null}
        onSaveAppSettings={vi.fn().mockResolvedValue(undefined)}
        onHealthRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /back up to server now/i }));
    expect(saveSpy).toHaveBeenCalled();
  });
});
