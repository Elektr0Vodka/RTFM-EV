import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { I18nProvider } from '../i18n/I18nProvider';
import { OwnerInfoPane } from '../components/repeater/RepeaterOwnerInfoPane';
import type { RepeaterOwnerInfoResponse, PaneState } from '../types';

const state: PaneState = { loading: false, attempt: 1, error: null };

function renderPane(
  data: RepeaterOwnerInfoResponse | null,
  onSaveOwnerInfo = vi.fn(),
  publicKey = 'a'.repeat(64)
) {
  return render(
    <I18nProvider>
      <OwnerInfoPane
        data={data}
        state={state}
        onRefresh={() => {}}
        publicKey={publicKey}
        onSaveOwnerInfo={onSaveOwnerInfo}
      />
    </I18nProvider>
  );
}

describe('OwnerInfoPane', () => {
  it('shows an override prompt when repeater owner differs from saved', () => {
    const onSave = vi.fn();
    renderPane(
      {
        owner_info: 'PA0NEW',
        firmware_version: 'v2',
        name: 'Rep',
        guest_password: null,
        stored_owner_info: 'PA0OLD',
        owner_info_updated: false,
      },
      onSave
    );
    const btn = screen.getByRole('button', { name: /override/i });
    fireEvent.click(btn);
    expect(onSave).toHaveBeenCalledWith('a'.repeat(64), 'PA0NEW');
  });

  it('shows the auto-filled note and no override prompt', () => {
    renderPane({
      owner_info: 'PA0NEW',
      firmware_version: 'v2',
      name: 'Rep',
      guest_password: null,
      stored_owner_info: 'PA0NEW',
      owner_info_updated: true,
    });
    expect(screen.queryByRole('button', { name: /override/i })).not.toBeInTheDocument();
  });
});
