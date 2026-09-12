import { describe, expect, it } from 'vitest';
import { MAX_BRAND_ICON_BYTES, validateBrandIconDataUrl } from '../utils/brandIcon';

describe('validateBrandIconDataUrl', () => {
  it('accepts a small png data url', () => {
    expect(validateBrandIconDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
  });

  it('rejects a non-image mime', () => {
    expect(validateBrandIconDataUrl('data:text/html;base64,PHN2Zz4=')).toBe(
      'settings_branding_icon_type_error'
    );
  });

  it('rejects a non-data url', () => {
    expect(validateBrandIconDataUrl('https://example.com/logo.png')).toBe(
      'settings_branding_icon_type_error'
    );
  });

  it('rejects an oversized icon', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(MAX_BRAND_ICON_BYTES);
    expect(validateBrandIconDataUrl(big)).toBe('settings_branding_icon_size_error');
  });
});
