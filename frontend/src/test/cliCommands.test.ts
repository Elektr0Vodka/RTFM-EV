import { describe, expect, it } from 'vitest';
import { CLI_COMMANDS, commandPrefix, matchCliCommands } from '../utils/cliCommands';

describe('commandPrefix', () => {
  it('is the whole syntax for a command without parameters', () => {
    expect(commandPrefix('clock sync')).toBe('clock sync');
  });

  it('stops at the first parameter', () => {
    expect(commandPrefix('set radio <freq>,<bw>,<sf>,<cr>')).toBe('set radio');
    expect(commandPrefix('region load <name> [flood_flag]')).toBe('region load');
    expect(commandPrefix('region default {name|<null>}')).toBe('region default');
  });

  it('does not keep words that belong to an optional parameter list', () => {
    // "[<token> ...]" is two words; the second is not part of the command.
    expect(commandPrefix('region def <token> [<token> ...]')).toBe('region def');
  });

  it('is never empty and never contains parameter marks, for every command', () => {
    for (const cmd of CLI_COMMANDS) {
      const prefix = commandPrefix(cmd.syntax);
      expect(prefix.length, cmd.syntax).toBeGreaterThan(0);
      expect(prefix, cmd.syntax).not.toMatch(/[<>[\]{}]/);
    }
  });
});

describe('matchCliCommands', () => {
  const syntaxes = (input: string, limit?: number) =>
    matchCliCommands(input, limit).map((cmd) => cmd.syntax);

  it('returns nothing for empty input', () => {
    expect(matchCliCommands('')).toEqual([]);
    expect(matchCliCommands('   ')).toEqual([]);
  });

  it('returns nothing for a line that starts with a space', () => {
    // A `region load` line: the leading spaces are the nesting depth.
    expect(matchCliCommands(' set tx')).toEqual([]);
    expect(matchCliCommands('  region')).toEqual([]);
  });

  it('suggests completions for a partial command name', () => {
    const matches = syntaxes('set r', 50);
    expect(matches).toContain('set radio <freq>,<bw>,<sf>,<cr>');
    expect(matches).toContain('set repeat <state>');
    expect(matches.every((s) => s.startsWith('set r'))).toBe(true);
  });

  it('ignores case and repeated spaces', () => {
    expect(syntaxes('SET   NAME')).toEqual(syntaxes('set name'));
  });

  it('keeps the parameter signature visible while parameters are typed', () => {
    expect(syntaxes('set tx 20')).toEqual(['set tx <dbm>']);
  });

  it('puts the command typed exactly first', () => {
    expect(syntaxes('gps')[0]).toBe('gps');
  });

  it('prefers the most specific command once parameters are being typed', () => {
    // "region" (the dump) also fits, but "region home" is what is being typed.
    const matches = syntaxes('region home nl');
    expect(matches.slice(0, 2)).toEqual(['region home', 'region home <name>']);
    expect(matches[matches.length - 1]).toBe('region');
  });

  it('caps the result', () => {
    expect(matchCliCommands('g', 3)).toHaveLength(3);
    expect(matchCliCommands('g').length).toBeLessThanOrEqual(8);
  });

  it('matches nothing for unknown text', () => {
    expect(matchCliCommands('xyzzy')).toEqual([]);
  });
});

describe('CLI_COMMANDS', () => {
  it('has no duplicate syntax (each is used as a list key)', () => {
    const seen = new Set<string>();
    for (const cmd of CLI_COMMANDS) {
      expect(seen.has(cmd.syntax), cmd.syntax).toBe(false);
      seen.add(cmd.syntax);
    }
  });

  it('flags the commands the firmware only accepts on a serial connection', () => {
    // CommonCLI.cpp gates these on sender_timestamp == 0.
    const serialOnly = [
      'erase',
      'log',
      'stats-core',
      'stats-radio',
      'stats-packets',
      'set freq <frequency>',
      'get prv.key',
      'set prv.key <private_key>',
    ];
    for (const syntax of serialOnly) {
      const cmd = CLI_COMMANDS.find((c) => c.syntax === syntax);
      expect(cmd, syntax).toBeDefined();
      expect(cmd!.description, syntax).toMatch(/serial only/);
    }
  });

  it('does not flag the log commands that do work over RF', () => {
    for (const syntax of ['log start', 'log stop', 'log erase']) {
      const cmd = CLI_COMMANDS.find((c) => c.syntax === syntax);
      expect(cmd!.description, syntax).not.toMatch(/serial only/);
    }
  });
});

describe('DMC firmware commands', () => {
  const find = (syntax: string) => CLI_COMMANDS.find((c) => c.syntax === syntax);

  it('covers SNMP, duty gate, packet filter, MQTT, alerts and OTA', () => {
    for (const syntax of [
      'set snmp <on|off>',
      'set snmp.community <string>',
      'set dc.gate <on|off>',
      'get dc.gate.status',
      'filter rate <type> <limit> <secs> [soft]',
      'filter stats <hops|rate|channel|hash|malformed|top|advert|path|air|sender|text|age>',
      'filter watch add <#name>',
      'set mqtt.tx <on|off|advert>',
      'set mqtt1.preset <name>',
      'set alert.interval <60-10080>',
      'ota branch <prod|beta|default>',
      'start webconfig [ap]',
      'room.post <message>',
    ]) {
      expect(find(syntax), syntax).toBeDefined();
    }
  });

  it('says which firmware a DMC-only command needs', () => {
    for (const cmd of CLI_COMMANDS.filter((c) => c.category.startsWith('DMC'))) {
      expect(cmd.description, cmd.syntax).toMatch(/\(DMC/);
    }
  });

  it('flags the DMC commands that only answer on serial', () => {
    for (const syntax of ['stats-radio-diag', 'get mqtt.owner', 'get alert.psk']) {
      expect(find(syntax)!.description, syntax).toMatch(/serial only/);
    }
  });

  it('suggests the duty gate commands', () => {
    const hits = matchCliCommands('set dc.gate', 8).map((c) => c.syntax);
    expect(hits).toEqual(
      expect.arrayContaining([
        'set dc.gate <on|off>',
        'set dc.gate.thresh <1-100>',
        'set dc.gate.hyst <0-50>',
      ])
    );
  });
});
