import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';

import { looksLikeCommunityPayload, qrSvgDataUrl, renderQrSvg } from '../utils/communityQr';

const PAYLOAD =
  '{"v":1,"type":"meshcore_community","name":"Acme","k":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="}';

describe('communityQr', () => {
  it('recognises a community payload', () => {
    expect(looksLikeCommunityPayload(PAYLOAD)).toBe(true);
    expect(looksLikeCommunityPayload('{"type":"other","k":"x"}')).toBe(false);
    expect(looksLikeCommunityPayload('meshcore://abcd')).toBe(false);
  });

  it('renders an SVG QR code', () => {
    const svg = renderQrSvg(PAYLOAD);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(qrSvgDataUrl(PAYLOAD)).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  });

  it('fits the payload in a QR code with UTF-8 names', () => {
    const { data, version } = encode(PAYLOAD.replace('Acme', 'Mesh Zuid-Holland é'), {
      ecc: 'M',
    });
    expect(data.length).toBeGreaterThan(0);
    expect(version).toBeLessThan(10);
  });
});
