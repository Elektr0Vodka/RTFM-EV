import { describe, expect, it } from 'vitest';

import {
  buildAnalyzerLookupUrl,
  buildChannelLookupUrl,
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

describe('buildChannelLookupUrl', () => {
  const nameSite: AnalyzerSite = {
    name: 'meshcore-analyzer.eu',
    node_url_template: 'https://meshcore-analyzer.eu/#node?id={pubkey}',
    channel_url_template: 'https://meshcore-analyzer.eu/#channels?channel={name}',
  };

  it('substitutes the channel display name into a {name} template', () => {
    expect(buildChannelLookupUrl(nameSite, { name: 'Public', key: 'a'.repeat(32) })).toBe(
      'https://meshcore-analyzer.eu/#channels?channel=Public'
    );
  });

  it('url-encodes a hashtag channel name (# -> %23)', () => {
    expect(buildChannelLookupUrl(nameSite, { name: '#test', key: 'a'.repeat(32) })).toBe(
      'https://meshcore-analyzer.eu/#channels?channel=%23test'
    );
  });

  it('substitutes the channel key into a {channel} template', () => {
    const keySite: AnalyzerSite = {
      name: 'custom',
      node_url_template: 'https://x.test/{pubkey}',
      channel_url_template: 'https://x.test/ch/{channel}',
    };
    expect(buildChannelLookupUrl(keySite, { name: 'Public', key: 'DEAD' })).toBe(
      'https://x.test/ch/DEAD'
    );
  });

  it('returns null when the site has no channel template', () => {
    const noChannel: AnalyzerSite = {
      name: 'mc-radar',
      node_url_template: 'https://mc-radar.woodwar.com/node/{pubkey}',
    };
    expect(buildChannelLookupUrl(noChannel, { name: 'Public', key: 'DEAD' })).toBeNull();
  });

  it('rejects a non-http(s) channel template', () => {
    const bad: AnalyzerSite = {
      name: 'bad',
      node_url_template: 'https://x.test/{pubkey}',
      channel_url_template: 'javascript:alert({name})',
    };
    expect(buildChannelLookupUrl(bad, { name: 'Public', key: 'DEAD' })).toBeNull();
  });

  it('rejects a template with neither {name} nor {channel}', () => {
    const bad: AnalyzerSite = {
      name: 'bad',
      node_url_template: 'https://x.test/{pubkey}',
      channel_url_template: 'https://x.test/channels',
    };
    expect(buildChannelLookupUrl(bad, { name: 'Public', key: 'DEAD' })).toBeNull();
  });

  it('returns null when a required value is empty', () => {
    expect(buildChannelLookupUrl(nameSite, { name: '', key: 'DEAD' })).toBeNull();
  });
});
