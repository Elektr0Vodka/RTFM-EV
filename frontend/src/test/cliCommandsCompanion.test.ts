import { describe, expect, it } from 'vitest';

import {
  CLI_COMMANDS,
  COMPANION_CLI_COMMANDS,
  isRiskyCompanionCommand,
  matchCliCommands,
} from '../utils/cliCommands';

describe('companion CLI commands (firmware 1.18)', () => {
  it('suggests companion-only commands from the companion list', () => {
    const hits = matchCliCommands('get tz', 8, COMPANION_CLI_COMMANDS).map((c) => c.syntax);
    expect(hits).toContain('get tz.offset');
  });

  it('does not offer repeater-only commands on the companion console', () => {
    expect(matchCliCommands('neighbors', 8, COMPANION_CLI_COMMANDS)).toHaveLength(0);
  });

  it('defaults to the repeater list', () => {
    expect(matchCliCommands('neighbors').length).toBeGreaterThan(0);
  });

  it('repeater list has the 1.18 power and gps diag commands', () => {
    const syntaxes = CLI_COMMANDS.map((c) => c.syntax);
    expect(syntaxes).toContain('power');
    expect(syntaxes).toContain('gps diag');
  });

  it.each([
    ['reboot', true],
    ['  poweroff', true],
    ['shutdown', true],
    ['set radio 869.618,62.5,8,5', true],
    ['set pin 123456', true],
    ['set wifi.ssid Home', true],
    ['0A|reboot', true],
    ['set radio.rxgain on', false],
    ['get radio', false],
    ['set tz.offset 2', false],
    ['ver', false],
    // meshcomod: reconnects or drops WiFi, so a TCP-connected radio goes away.
    ['wifi.apply', true],
    ['set wifi.apply', true],
    ['wifi.clear', true],
    ['set snmp on', false],
    ['filter on', false],
  ])('isRiskyCompanionCommand(%s) = %s', (command, risky) => {
    expect(isRiskyCompanionCommand(command)).toBe(risky);
  });
});

describe('meshcomod companion commands', () => {
  const syntaxes = COMPANION_CLI_COMMANDS.map((c) => c.syntax);

  it('has no duplicate syntax', () => {
    expect(new Set(syntaxes).size).toBe(syntaxes.length);
  });

  it('lists the SNMP and receive filter commands', () => {
    for (const syntax of [
      'get snmp',
      'set snmp <on|off>',
      'get snmp.status',
      'set snmp.community <string>',
      'wifi.apply',
      'filter',
      'filter age <minutes|off>',
      'filter sender add <name> [secs] [prob]',
      'filter stats <malformed|age|path|sender|text>',
    ]) {
      expect(syntaxes, syntax).toContain(syntax);
    }
  });

  it('offers the companion filter, not the repeater packet filter', () => {
    const hits = matchCliCommands('filter ', 50, COMPANION_CLI_COMMANDS).map((c) => c.syntax);
    expect(hits).toContain('filter age <minutes|off>');
    // hops / rate / channel are repeater (DMC) packet filter settings.
    expect(hits.some((h) => h.startsWith('filter hops'))).toBe(false);
  });

  it('marks the settings meshcomod does not support', () => {
    for (const syntax of ['get cad', 'set int.thresh <value>', 'set direct.txdelay <0-2>']) {
      const cmd = COMPANION_CLI_COMMANDS.find((c) => c.syntax === syntax);
      expect(cmd!.description, syntax).toMatch(/not on meshcomod/);
    }
    const tx = COMPANION_CLI_COMMANDS.find((c) => c.syntax === 'set tx <dbm>');
    expect(tx!.description).not.toMatch(/meshcomod/);
  });
});
