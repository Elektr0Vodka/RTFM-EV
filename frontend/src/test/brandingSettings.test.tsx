import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BrandingSettings } from '../components/settings/BrandingSettings';
import type { AppSettings } from '../types';

const baseSettings = {
  brand_name: '',
  brand_hidden: false,
  brand_icon: '',
} as unknown as AppSettings;

function renderBranding(onSave = vi.fn()) {
  return render(<BrandingSettings appSettings={baseSettings} onSave={onSave} />);
}

describe('BrandingSettings', () => {
  afterEach(() => cleanup());

  it('saves a new name on change', () => {
    const onSave = vi.fn();
    renderBranding(onSave);
    const input = screen.getByLabelText(/app name/i);
    fireEvent.change(input, { target: { value: 'MeshHQ' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith({ brand_name: 'MeshHQ' });
  });

  it('saves the hide toggle', () => {
    const onSave = vi.fn();
    renderBranding(onSave);
    fireEvent.click(screen.getByLabelText(/hide the name/i));
    expect(onSave).toHaveBeenCalledWith({ brand_hidden: true });
  });
});
