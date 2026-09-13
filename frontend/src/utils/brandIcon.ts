/** Client-side brand-icon validation, mirroring the server rules in
 * app/routers/settings.py. Returns an i18n error key, or null when valid. */

export const MAX_BRAND_ICON_BYTES = 131072; // 128 KB
export const ALLOWED_BRAND_ICON_MIMES = [
  'image/png',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/jpeg',
];

export function validateBrandIconDataUrl(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) return null; // empty clears the icon
  if (cleaned.length > MAX_BRAND_ICON_BYTES) return 'settings_branding_icon_size_error';
  if (!cleaned.startsWith('data:')) return 'settings_branding_icon_type_error';
  const comma = cleaned.indexOf(',');
  const header = comma >= 0 ? cleaned.slice(5, comma) : '';
  const mime = header.split(';', 1)[0].trim().toLowerCase();
  if (!ALLOWED_BRAND_ICON_MIMES.includes(mime)) return 'settings_branding_icon_type_error';
  return null;
}
