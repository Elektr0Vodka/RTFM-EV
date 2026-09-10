import { describe, expect, it } from 'vitest';

import {
  buildAnalyzerLookupUrl,
  buildNodeLookupUrl,
  buildPacketLookupUrl,
} from '../utils/analyzerLink';
import type { AnalyzerSite } from '../types';

const PUBKEY = 'a'.repeat(64);

describe('buildAnalyzerLookupUrl', () => {
  it('substitutes the placeholder into an http(s) template', () => {
    expect(
      buildAnalyzerLookupUrl('https://mc-radar.woodwar.com/node/{pubkey}', '{pubkey}', PUBKEY)
    ).toBe(`https://mc-radar.woodwar.com/node/${PUBKEY}`);
  });

  it('substitutes into a fragment-style template', () => {
    expect(
      buildAnalyzerLookupUrl('https://cornmeister.nl/#node?id={pubkey}', '{pubkey}', PUBKEY)
    ).toBe(`https://cornmeister.nl/#node?id=${PUBKEY}`);
  });

  it('trims surrounding whitespace in the template', () => {
    expect(buildAnalyzerLookupUrl('  https://x.test/{pubkey}  ', '{pubkey}', PUBKEY)).toBe(
      `https://x.test/${PUBKEY}`
    );
  });

  it('rejects a non-http(s) scheme', () => {
    expect(buildAnalyzerLookupUrl("javascript:alert('{pubkey}')", '{pubkey}', PUBKEY)).toBeNull();
    expect(buildAnalyzerLookupUrl('ftp://x.test/{pubkey}', '{pubkey}', PUBKEY)).toBeNull();
  });

  it('rejects a template missing the placeholder', () => {
    expect(buildAnalyzerLookupUrl('https://x.test/node', '{pubkey}', PUBKEY)).toBeNull();
  });

  it('rejects an empty value', () => {
    expect(buildAnalyzerLookupUrl('https://x.test/{pubkey}', '{pubkey}', '')).toBeNull();
  });
});

describe('buildNodeLookupUrl / buildPacketLookupUrl', () => {
  const site: AnalyzerSite = {
    name: 'cornmeister',
    node_url_template: 'https://cornmeister.nl/#node?id={pubkey}',
    packet_url_template: 'https://cornmeister.nl/#packets?hash={hash}',
  };

  it('builds a node URL from a site', () => {
    expect(buildNodeLookupUrl(site, PUBKEY)).toBe(`https://cornmeister.nl/#node?id=${PUBKEY}`);
  });

  it('builds a packet URL when the site has a packet template', () => {
    expect(buildPacketLookupUrl(site, 'deadbeef')).toBe(
      'https://cornmeister.nl/#packets?hash=deadbeef'
    );
  });

  it('returns null for packet lookup when no packet template is configured', () => {
    const nodeOnly: AnalyzerSite = {
      name: 'mc-radar',
      node_url_template: 'https://mc-radar.woodwar.com/node/{pubkey}',
    };
    expect(buildPacketLookupUrl(nodeOnly, 'deadbeef')).toBeNull();
  });
});
