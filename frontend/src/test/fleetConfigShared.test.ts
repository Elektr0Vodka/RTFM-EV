import { describe, expect, it } from 'vitest';

import {
  configFilename,
  configSections,
  diffConfigs,
  fittingProfiles,
  roleFromFilename,
} from '../components/fleet/fleetConfigShared';

const STORED = { $secret: 7 };
const MISSING = { $secret: null };

const toolbox = {
  vars: {
    name: 'NL-TST-RPT',
    repeat: true,
    radio: { freq: '869.618', bw: '62.5' },
    tx: 22,
    'guest.password': MISSING,
    'prv.key': STORED,
    'owner.info': '',
  },
  filter: { enabled: true, channels: [] },
  mqtt: { wifiSsid: 'mesh-lab', slots: [{ server: 'mqtt.example.org', token: { $secret: 9 } }] },
};

const companion = {
  version: 1,
  name: 'My Companion',
  tx_power: 20,
  radio: { freq: 869.618, sf: 8 },
  private_key: MISSING,
};

describe('configSections', () => {
  it('gives one section per part of a toolbox file, in the order of the file', () => {
    const sections = configSections(toolbox);

    expect(sections.map((section) => section.key)).toEqual(['vars', 'filter', 'mqtt']);
    expect(sections[0].rows.map((row) => row.path)).toEqual([
      'name',
      'repeat',
      'radio/freq',
      'radio/bw',
      'tx',
      'guest.password',
      'prv.key',
      'owner.info',
    ]);
  });

  it('shows values as text and never a secret', () => {
    const [vars, filter, mqtt] = configSections(toolbox);
    const leaf = (path: string) => vars.rows.find((row) => row.path === path)?.leaf;

    expect(leaf('name')).toEqual({ secret: false, text: 'NL-TST-RPT' });
    expect(leaf('repeat')).toEqual({ secret: false, text: 'true' });
    expect(leaf('tx')).toEqual({ secret: false, text: '22' });
    expect(leaf('owner.info')).toEqual({ secret: false, text: '' });
    expect(leaf('prv.key')).toEqual({ secret: true, id: 7 });
    expect(leaf('guest.password')).toEqual({ secret: true, id: null });
    expect(filter.rows).toEqual([
      { path: 'enabled', leaf: { secret: false, text: 'true' } },
      { path: 'channels', leaf: { secret: false, text: '[]' } },
    ]);
    expect(mqtt.rows.map((row) => row.path)).toEqual([
      'wifiSsid',
      'slots/0/server',
      'slots/0/token',
    ]);
  });

  it('puts the loose values of a companion file in a section of their own', () => {
    const sections = configSections(companion);

    expect(sections.map((section) => section.key)).toEqual(['', 'radio']);
    expect(sections[0].rows.map((row) => row.path)).toEqual([
      'version',
      'name',
      'tx_power',
      'private_key',
    ]);
    expect(sections[1].rows).toEqual([
      { path: 'freq', leaf: { secret: false, text: '869.618' } },
      { path: 'sf', leaf: { secret: false, text: '8' } },
    ]);
  });
});

describe('diffConfigs', () => {
  it('lists what changed, what was added and what is gone', () => {
    const right = {
      ...toolbox,
      vars: { ...toolbox.vars, tx: 20, 'flood.max': 64 },
      filter: { enabled: true },
    };

    const diff = diffConfigs(toolbox, right);

    expect(diff.changed).toEqual([
      {
        path: 'vars/tx',
        left: { secret: false, text: '22' },
        right: { secret: false, text: '20' },
      },
      { path: 'filter/channels', left: { secret: false, text: '[]' }, right: null },
      { path: 'vars/flood.max', left: null, right: { secret: false, text: '64' } },
    ]);
  });

  it('counts what is the same and tells a number from the same digits as text', () => {
    const diff = diffConfigs({ vars: { a: 1, b: 'x' } }, { vars: { a: '1', b: 'x' } });

    expect(diff.same).toBe(1);
    expect(diff.changed.map((row) => row.path)).toEqual(['vars/a']);
  });

  it('treats the same vault entry as the same secret', () => {
    const diff = diffConfigs(toolbox, toolbox);

    expect(diff.changed).toEqual([]);
    // Not stored on both sides: nothing to compare.
    expect(diff.uncompared).toEqual(['vars/guest.password']);
  });

  it('reports another vault entry as a change without showing anything', () => {
    const right = { ...toolbox, vars: { ...toolbox.vars, 'prv.key': { $secret: 8 } } };

    const diff = diffConfigs(toolbox, right);

    expect(diff.changed).toEqual([
      { path: 'vars/prv.key', left: { secret: true, id: 7 }, right: { secret: true, id: 8 } },
    ]);
  });

  it('cannot compare a stored secret with one that was left out', () => {
    const right = { ...toolbox, vars: { ...toolbox.vars, 'prv.key': MISSING } };

    const diff = diffConfigs(toolbox, right);

    expect(diff.changed).toEqual([]);
    expect(diff.uncompared).toEqual(['vars/guest.password', 'vars/prv.key']);
  });

  it('sees a secret that became an empty value', () => {
    const right = { ...toolbox, vars: { ...toolbox.vars, 'prv.key': '' } };

    expect(diffConfigs(toolbox, right).changed).toEqual([
      { path: 'vars/prv.key', left: { secret: true, id: 7 }, right: { secret: false, text: '' } },
    ]);
  });
});

describe('configFilename', () => {
  it('names a toolbox file the way the toolbox does', () => {
    expect(configFilename('dmc_observer', 'repeater', toolbox)).toBe(
      'config-repeater-NL-TST-RPT.json'
    );
    expect(configFilename('stock', 'room server', { vars: { name: 'Café #1' } })).toBe(
      'config-room_server-Caf___1.json'
    );
    expect(configFilename('stock', null, { vars: {} })).toBe('config-unknown-noname.json');
  });

  it('names a companion file after the radio', () => {
    expect(configFilename('companion_v1', null, companion)).toBe('My_Companion-config.json');
    expect(configFilename('companion_v1', null, { version: 1 })).toBe('radio-config.json');
  });
});

describe('roleFromFilename', () => {
  it('reads the role out of a toolbox file name', () => {
    expect(roleFromFilename('config-repeater-NL-TST-RPT.json')).toBe('repeater');
    expect(roleFromFilename('config-room_server-Hall.json')).toBe('room_server');
  });

  it('gives nothing for another name', () => {
    expect(roleFromFilename('My_Companion-config.json')).toBe('');
    expect(roleFromFilename('config-unknown-noname.json')).toBe('');
  });
});

describe('fittingProfiles', () => {
  it('offers only the profiles of the file format', () => {
    expect(fittingProfiles(toolbox)).toEqual(['stock', 'dmc_repeater', 'dmc_observer']);
    expect(fittingProfiles(companion)).toEqual(['companion_v1']);
  });
});
