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
  ])('isRiskyCompanionCommand(%s) = %s', (command, risky) => {
    expect(isRiskyCompanionCommand(command)).toBe(risky);
  });
});
