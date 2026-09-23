import { describe, it, expect } from 'vitest';

import { buildNodesGpx, gpxExportFilename, type GpxExportContact } from '../utils/gpxExport';

const typeLabel = (type: number) =>
  ({ 1: 'Client', 2: 'Repeater', 3: 'Room', 4: 'Sensor' })[type] ?? 'Unknown';

function contact(overrides: Partial<GpxExportContact> = {}): GpxExportContact {
  return {
    public_key: 'aa'.repeat(32),
    name: 'Test Node',
    type: 2,
    lat: 52.1,
    lon: 4.3,
    manual_lat: null,
    manual_lon: null,
    ...overrides,
  };
}

describe('buildNodesGpx', () => {
  it('emits a valid GPX 1.1 document with one waypoint per located contact', () => {
    const gpx = buildNodesGpx([contact()], { typeLabel, manualLocationLabel: 'manual location' });

    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx.match(/<wpt /g)).toHaveLength(1);
    expect(gpx).toContain('lat="52.1" lon="4.3"');
    expect(gpx).toContain('<name>Test Node</name>');
    expect(gpx).toContain(`<desc>Repeater - ${'aa'.repeat(32)}</desc>`);
  });

  it('skips contacts with no usable location', () => {
    const gpx = buildNodesGpx(
      [contact({ lat: null, lon: null }), contact({ public_key: 'bb'.repeat(32) })],
      { typeLabel, manualLocationLabel: 'manual location' }
    );

    expect(gpx.match(/<wpt /g)).toHaveLength(1);
    expect(gpx).toContain('bb'.repeat(32));
    expect(gpx).not.toContain('aa'.repeat(32));
  });

  it('emits an empty gpx element when nothing has a location', () => {
    const gpx = buildNodesGpx([contact({ lat: null, lon: null })], {
      typeLabel,
      manualLocationLabel: 'manual location',
    });

    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).not.toContain('<wpt');
  });

  it('falls back to the manual location and notes it in the desc', () => {
    const gpx = buildNodesGpx(
      [contact({ lat: null, lon: null, manual_lat: 51.5, manual_lon: 3.5 })],
      { typeLabel, manualLocationLabel: 'manual location' }
    );

    expect(gpx).toContain('lat="51.5" lon="3.5"');
    expect(gpx).toContain('(manual location)');
  });

  it('prefers the advertised location over a manual override and does not mark it manual', () => {
    const gpx = buildNodesGpx(
      [contact({ lat: 52.1, lon: 4.3, manual_lat: 51.5, manual_lon: 3.5 })],
      { typeLabel, manualLocationLabel: 'manual location' }
    );

    expect(gpx).toContain('lat="52.1" lon="4.3"');
    expect(gpx).not.toContain('manual location');
  });

  it('treats (0, 0) advertised coordinates as unset and falls back to manual', () => {
    const gpx = buildNodesGpx([contact({ lat: 0, lon: 0, manual_lat: 10, manual_lon: 20 })], {
      typeLabel,
      manualLocationLabel: 'manual location',
    });

    expect(gpx).toContain('lat="10" lon="20"');
    expect(gpx).toContain('manual location');
  });

  it('includes a meshcore:// link when one is supplied for the node', () => {
    const uri = 'meshcore://1100aabbcc';
    const gpx = buildNodesGpx([contact()], {
      typeLabel,
      manualLocationLabel: 'manual location',
      links: new Map([['aa'.repeat(32), uri]]),
    });

    expect(gpx).toContain(`<link href="${uri}"><text>${uri}</text></link>`);
  });

  it('accepts a plain record for links, matched case-insensitively', () => {
    const uri = 'meshcore://1100aabbcc';
    const gpx = buildNodesGpx([contact({ public_key: 'AA'.repeat(32) })], {
      typeLabel,
      manualLocationLabel: 'manual location',
      links: { [`${'aa'.repeat(32)}`]: uri },
    });

    expect(gpx).toContain(`href="${uri}"`);
  });

  it('omits the link element when no link is supplied for the node', () => {
    const gpx = buildNodesGpx([contact()], {
      typeLabel,
      manualLocationLabel: 'manual location',
      links: new Map([['bb'.repeat(32), 'meshcore://ff']]),
    });

    expect(gpx).not.toContain('<link');
  });

  it('escapes XML special characters in name and desc', () => {
    const gpx = buildNodesGpx([contact({ name: '<Node> "Alpha" & \'friends\'' })], {
      typeLabel,
      manualLocationLabel: 'manual location',
    });

    expect(gpx).toContain('<name>&lt;Node&gt; &quot;Alpha&quot; &amp; &apos;friends&apos;</name>');
    expect(gpx).not.toContain('<Node>');
  });

  it('falls back to a public-key-prefix name when the contact has none', () => {
    const gpx = buildNodesGpx([contact({ name: null })], {
      typeLabel,
      manualLocationLabel: 'manual location',
    });

    expect(gpx).toContain(`<name>${'aa'.repeat(32).slice(0, 12)}</name>`);
  });

  it('falls back to a public-key-prefix name when the contact name is blank', () => {
    const gpx = buildNodesGpx([contact({ name: '   ' })], {
      typeLabel,
      manualLocationLabel: 'manual location',
    });

    expect(gpx).toContain(`<name>${'aa'.repeat(32).slice(0, 12)}</name>`);
  });
});

describe('gpxExportFilename', () => {
  it('formats as rtfm-ev-nodes-YYYY-MM-DD.gpx', () => {
    expect(gpxExportFilename(new Date(2026, 8, 23))).toBe('rtfm-ev-nodes-2026-09-23.gpx');
  });

  it('zero-pads single-digit months and days', () => {
    expect(gpxExportFilename(new Date(2026, 0, 5))).toBe('rtfm-ev-nodes-2026-01-05.gpx');
  });
});
