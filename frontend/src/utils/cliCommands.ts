// Static reference of the stock MeshCore repeater / room / sensor CLI, used for
// the type-ahead in the repeater console. The firmware has no `help` command, so
// these one-line descriptions are the only hint available at the console.
//
// Table taken from the wchaney817/Remote-Terminal-for-MeshCore fork (`3011b25f`,
// `08f4943c`) and checked again on 2026-10-10 against meshcore-dev/MeshCore:
// - docs/cli_commands.md (`c58c9b2f`): 140 of the 143 commands are listed there.
// - src/helpers/CommonCLI.cpp (`e2aa7b98`): `erase`, bare `log`, `stats-core`,
//   `stats-radio`, `stats-packets`, `set freq` and `prv.key` are gated on
//   `sender_timestamp == 0`, so they only work on a serial connection.
// - examples/simple_sensor/SensorMesh.cpp: the `io` GPIO commands, which the docs
//   page does not list.
//
// "(serial only)" marks a command this console cannot run: it talks to the node
// over RF. Those stay in the list so a suggestion says why nothing comes back.
//
// Not covered: commands that only exist in other firmware builds (DMC repeater,
// DMC MQTT, observer). See the CLI docs link in the console header for those.
//
// Descriptions are English only, like the firmware's own replies.
export interface CliCommand {
  syntax: string;
  description: string;
  category: string;
}

export const CLI_COMMANDS: CliCommand[] = [
  { category: 'Operational', syntax: 'reboot', description: 'Restart the node' },
  { category: 'Operational', syntax: 'poweroff', description: 'Turn off the node' },
  { category: 'Operational', syntax: 'shutdown', description: 'Turn off the node' },
  { category: 'Operational', syntax: 'clkreboot', description: 'Reset the clock and reboot' },
  {
    category: 'Operational',
    syntax: 'clock sync',
    description: 'Synchronize clock with remote device',
  },
  { category: 'Operational', syntax: 'clock', description: 'Display current UTC time' },
  {
    category: 'Operational',
    syntax: 'time <epoch_seconds>',
    description: 'Set time to specific Unix timestamp',
  },
  { category: 'Operational', syntax: 'advert', description: 'Send a flood advertisement' },
  {
    category: 'Operational',
    syntax: 'advert.zerohop',
    description: 'Send a zero-hop advertisement',
  },
  {
    category: 'Operational',
    syntax: 'start ota',
    description: 'Initiate Over-The-Air firmware update',
  },
  {
    category: 'Operational',
    syntax: 'erase',
    description: 'Factory reset the node (destructive, serial only)',
  },

  {
    category: 'Neighbors',
    syntax: 'neighbors',
    description: 'List the 8 most recent nearby neighbors',
  },
  {
    category: 'Neighbors',
    syntax: 'neighbor.remove <pubkey_prefix>',
    description: 'Remove a neighbor from list',
  },
  {
    category: 'Neighbors',
    syntax: 'discover.neighbors',
    description: 'Discover zero hop neighbors',
  },

  { category: 'Statistics', syntax: 'clear stats', description: 'Reset all statistics counters' },
  {
    category: 'Statistics',
    syntax: 'stats-core',
    description: 'Display battery, uptime, queue, debug flags (serial only)',
  },
  {
    category: 'Statistics',
    syntax: 'stats-radio',
    description: 'Display noise floor, RSSI, SNR, airtime, errors (serial only)',
  },
  {
    category: 'Statistics',
    syntax: 'stats-packets',
    description: 'Display received and sent packet counters (serial only)',
  },

  { category: 'Logging', syntax: 'log start', description: 'Begin capturing rx log to storage' },
  { category: 'Logging', syntax: 'log stop', description: 'End capturing rx log to storage' },
  { category: 'Logging', syntax: 'log erase', description: 'Delete captured log' },
  {
    category: 'Logging',
    syntax: 'log',
    description: 'Print captured log to terminal (serial only)',
  },

  { category: 'Info', syntax: 'ver', description: 'Show firmware version' },
  { category: 'Info', syntax: 'board', description: 'Display hardware name' },

  { category: 'Radio', syntax: 'get radio', description: 'View radio parameters' },
  {
    category: 'Radio',
    syntax: 'set radio <freq>,<bw>,<sf>,<cr>',
    description: 'Set radio parameters',
  },
  { category: 'Radio', syntax: 'get tx', description: 'View transmit power' },
  { category: 'Radio', syntax: 'set tx <dbm>', description: 'Set transmit power level' },
  {
    category: 'Radio',
    syntax: 'tempradio <freq>,<bw>,<sf>,<cr>,<timeout_mins>',
    description: 'Temporarily change radio settings',
  },
  { category: 'Radio', syntax: 'get freq', description: 'View frequency setting' },
  {
    category: 'Radio',
    syntax: 'set freq <frequency>',
    description: 'Set frequency (serial only, reboot to apply)',
  },
  { category: 'Radio', syntax: 'get radio.rxgain', description: 'View rx boosted gain mode' },
  {
    category: 'Radio',
    syntax: 'set radio.rxgain <state>',
    description: 'Set rx boosted gain mode',
  },
  { category: 'Radio', syntax: 'get radio.fem.rxgain', description: 'View LoRa FEM rx gain state' },
  {
    category: 'Radio',
    syntax: 'set radio.fem.rxgain <state>',
    description: 'Set LoRa FEM rx gain state',
  },
  { category: 'Radio', syntax: 'get radio.fem.txgain', description: 'View LoRa FEM tx gain state' },
  {
    category: 'Radio',
    syntax: 'set radio.fem.txgain <state>',
    description: 'Set LoRa FEM tx gain state',
  },

  { category: 'System', syntax: 'get name', description: 'View node name' },
  { category: 'System', syntax: 'set name <name>', description: 'Set node name' },
  { category: 'System', syntax: 'get lat', description: 'View latitude' },
  { category: 'System', syntax: 'set lat <degrees>', description: 'Set latitude' },
  { category: 'System', syntax: 'get lon', description: 'View longitude' },
  { category: 'System', syntax: 'set lon <degrees>', description: 'Set longitude' },
  { category: 'System', syntax: 'get prv.key', description: 'View private key (serial only)' },
  {
    category: 'System',
    syntax: 'set prv.key <private_key>',
    description: 'Set private key (serial only)',
  },
  { category: 'System', syntax: 'password <new_password>', description: 'Change admin password' },
  { category: 'System', syntax: 'get guest.password', description: 'View guest password' },
  {
    category: 'System',
    syntax: 'set guest.password <password>',
    description: 'Set guest password',
  },
  { category: 'System', syntax: 'get owner.info', description: 'View owner information' },
  { category: 'System', syntax: 'set owner.info <text>', description: 'Set owner information' },
  { category: 'System', syntax: 'get adc.multiplier', description: 'View ADC multiplier' },
  { category: 'System', syntax: 'set adc.multiplier <value>', description: 'Set ADC multiplier' },
  { category: 'System', syntax: 'get public.key', description: 'Display public key' },
  { category: 'System', syntax: 'get role', description: "View node's configured role" },
  { category: 'System', syntax: 'powersaving', description: 'View power saving state' },
  { category: 'System', syntax: 'powersaving on', description: 'Enable power saving' },
  { category: 'System', syntax: 'powersaving off', description: 'Disable power saving' },

  { category: 'Routing', syntax: 'get repeat', description: 'View repeat flag' },
  { category: 'Routing', syntax: 'set repeat <state>', description: 'Set repeat flag' },
  { category: 'Routing', syntax: 'get path.hash.mode', description: 'View advert path hash size' },
  {
    category: 'Routing',
    syntax: 'set path.hash.mode <0|1|2>',
    description: 'Set advert path hash size',
  },
  { category: 'Routing', syntax: 'get loop.detect', description: 'View loop detection setting' },
  {
    category: 'Routing',
    syntax: 'set loop.detect <off|minimal|moderate|strict>',
    description: 'Set loop detection level',
  },
  {
    category: 'Routing',
    syntax: 'get txdelay',
    description: 'View flood traffic retransmit delay',
  },
  {
    category: 'Routing',
    syntax: 'set txdelay <value>',
    description: 'Set flood traffic retransmit delay',
  },
  {
    category: 'Routing',
    syntax: 'get direct.txdelay',
    description: 'View direct traffic retransmit delay',
  },
  {
    category: 'Routing',
    syntax: 'set direct.txdelay <value>',
    description: 'Set direct traffic retransmit delay',
  },
  {
    category: 'Routing',
    syntax: 'get rxdelay',
    description: 'View receive traffic processing delay',
  },
  {
    category: 'Routing',
    syntax: 'set rxdelay <value>',
    description: 'Set receive traffic processing delay',
  },
  { category: 'Routing', syntax: 'get dutycycle', description: 'View duty cycle limit percentage' },
  {
    category: 'Routing',
    syntax: 'set dutycycle <value>',
    description: 'Set duty cycle limit percentage',
  },
  { category: 'Routing', syntax: 'get af', description: 'View airtime factor (deprecated)' },
  { category: 'Routing', syntax: 'set af <value>', description: 'Set airtime factor (deprecated)' },
  {
    category: 'Routing',
    syntax: 'get int.thresh',
    description: 'View local interference threshold',
  },
  {
    category: 'Routing',
    syntax: 'set int.thresh <value>',
    description: 'Set local interference threshold',
  },
  {
    category: 'Routing',
    syntax: 'get cad',
    description: 'View hardware Channel Activity Detection',
  },
  {
    category: 'Routing',
    syntax: 'set cad <on|off>',
    description: 'Enable or disable hardware CAD',
  },
  { category: 'Routing', syntax: 'get agc.reset.interval', description: 'View AGC reset interval' },
  {
    category: 'Routing',
    syntax: 'set agc.reset.interval <value>',
    description: 'Set AGC reset interval',
  },
  { category: 'Routing', syntax: 'get multi.acks', description: 'View Multi-Acks support' },
  {
    category: 'Routing',
    syntax: 'set multi.acks <0|1>',
    description: 'Enable or disable Multi-Acks',
  },
  {
    category: 'Routing',
    syntax: 'get flood.advert.interval',
    description: 'View flood advert interval',
  },
  {
    category: 'Routing',
    syntax: 'set flood.advert.interval <hours>',
    description: 'Set flood advert interval',
  },
  {
    category: 'Routing',
    syntax: 'get advert.interval',
    description: 'View zero-hop advert interval',
  },
  {
    category: 'Routing',
    syntax: 'set advert.interval <minutes>',
    description: 'Set zero-hop advert interval',
  },
  { category: 'Routing', syntax: 'get flood.max', description: 'View maximum flood hops' },
  { category: 'Routing', syntax: 'set flood.max <value>', description: 'Set maximum flood hops' },
  {
    category: 'Routing',
    syntax: 'get flood.max.unscoped',
    description: 'View max hops for unscoped flood',
  },
  {
    category: 'Routing',
    syntax: 'set flood.max.unscoped <value>',
    description: 'Set max hops for unscoped flood',
  },
  {
    category: 'Routing',
    syntax: 'get flood.max.advert',
    description: 'View max hops for advert flood',
  },
  {
    category: 'Routing',
    syntax: 'set flood.max.advert <value>',
    description: 'Set max hops for advert flood',
  },

  {
    category: 'ACL',
    syntax: 'setperm <pubkey> <permissions>',
    description: 'Add or update companion permissions',
  },
  { category: 'ACL', syntax: 'get acl', description: 'Display current ACL entries (serial only)' },
  { category: 'ACL', syntax: 'get allow.read.only', description: 'View read-only flag' },
  { category: 'ACL', syntax: 'set allow.read.only <state>', description: 'Set read-only flag' },

  { category: 'Region', syntax: 'region load', description: 'Bulk-load region lists' },
  {
    category: 'Region',
    syntax: 'region load <name> [flood_flag]',
    description: 'Load specific region',
  },
  { category: 'Region', syntax: 'region save', description: 'Persist region changes to storage' },
  { category: 'Region', syntax: 'region allowf <name>', description: 'Enable flooding for region' },
  { category: 'Region', syntax: 'region denyf <name>', description: 'Disable flooding for region' },
  { category: 'Region', syntax: 'region get <name>', description: 'Display region information' },
  { category: 'Region', syntax: 'region home', description: 'View home region' },
  { category: 'Region', syntax: 'region home <name>', description: 'Set home region' },
  { category: 'Region', syntax: 'region default', description: 'View default scope region' },
  {
    category: 'Region',
    syntax: 'region default {name|<null>}',
    description: 'Set default scope region',
  },
  {
    category: 'Region',
    syntax: 'region put <name> [parent_name]',
    description: 'Create new region',
  },
  {
    category: 'Region',
    syntax: 'region def <token> [<token> ...]',
    description: 'Define region hierarchy',
  },
  { category: 'Region', syntax: 'region remove <name>', description: 'Delete region' },
  {
    category: 'Region',
    syntax: 'region list <filter>',
    description: 'Display filtered regions (serial only)',
  },
  {
    category: 'Region',
    syntax: 'region',
    description: 'Dump all regions and flood permissions (serial only before firmware 1.12.0)',
  },

  { category: 'GPS', syntax: 'gps', description: 'View GPS state' },
  { category: 'GPS', syntax: 'gps <state>', description: 'Enable or disable GPS' },
  { category: 'GPS', syntax: 'gps sync', description: 'Synchronize clock using GPS time' },
  { category: 'GPS', syntax: 'gps setloc', description: 'Set location from GPS coordinates' },
  { category: 'GPS', syntax: 'gps advert', description: 'View GPS advert policy' },
  { category: 'GPS', syntax: 'gps advert <policy>', description: 'Set GPS advert policy' },

  { category: 'Sensors', syntax: 'sensor list [start]', description: 'Display available sensors' },
  { category: 'Sensors', syntax: 'sensor get <key>', description: 'View sensor value' },
  { category: 'Sensors', syntax: 'sensor set <key> <value>', description: 'Set sensor value' },
  {
    category: 'Sensors',
    syntax: 'io',
    description: 'Read GPIO register as hex (sensor role only)',
  },
  {
    category: 'Sensors',
    syntax: 'io <hex_val>',
    description: 'Write GPIO register directly (sensor role only)',
  },
  {
    category: 'Sensors',
    syntax: 'io s <hex_mask>',
    description: 'Set GPIO bits HIGH without altering others (sensor role only)',
  },
  {
    category: 'Sensors',
    syntax: 'io r <hex_mask>',
    description: 'Reset GPIO bits LOW without altering others (sensor role only)',
  },
  {
    category: 'Sensors',
    syntax: 'io t <hex_mask>',
    description: 'Toggle GPIO bits (sensor role only)',
  },

  { category: 'Bridge', syntax: 'get bridge.type', description: 'Display compiled bridge type' },
  { category: 'Bridge', syntax: 'get bridge.enabled', description: 'View bridge enabled flag' },
  {
    category: 'Bridge',
    syntax: 'set bridge.enabled <state>',
    description: 'Enable or disable bridge',
  },
  { category: 'Bridge', syntax: 'get bridge.delay', description: 'View bridge packet delay' },
  { category: 'Bridge', syntax: 'set bridge.delay <ms>', description: 'Set bridge packet delay' },
  { category: 'Bridge', syntax: 'get bridge.source', description: 'View bridged packet source' },
  {
    category: 'Bridge',
    syntax: 'set bridge.source <source>',
    description: 'Set bridged packet source',
  },
  { category: 'Bridge', syntax: 'get bridge.baud', description: 'View bridge baud rate' },
  { category: 'Bridge', syntax: 'set bridge.baud <rate>', description: 'Set bridge baud rate' },
  { category: 'Bridge', syntax: 'get bridge.channel', description: 'View bridge channel' },
  { category: 'Bridge', syntax: 'set bridge.channel <channel>', description: 'Set bridge channel' },
  { category: 'Bridge', syntax: 'get bridge.secret', description: 'View ESP-Now secret' },
  { category: 'Bridge', syntax: 'set bridge.secret <secret>', description: 'Set ESP-Now secret' },

  {
    category: 'Power',
    syntax: 'get bootloader.ver',
    description: 'Display bootloader version (nRF52 only)',
  },
  {
    category: 'Power',
    syntax: 'get pwrmgt.support',
    description: 'Display power management support',
  },
  { category: 'Power', syntax: 'get pwrmgt.source', description: 'Display current power source' },
  { category: 'Power', syntax: 'get pwrmgt.bootreason', description: 'Display boot reset reasons' },
  { category: 'Power', syntax: 'get pwrmgt.bootmv', description: 'Display boot voltage' },

  { category: 'Ethernet', syntax: 'eth.status', description: 'View Ethernet connection status' },
];

/** The literal part of a syntax: every word before its first parameter. */
export function commandPrefix(syntax: string): string {
  const words: string[] = [];
  for (const token of syntax.split(/\s+/)) {
    if (/^[<[{]/.test(token)) break;
    words.push(token);
  }
  return words.join(' ');
}

/**
 * Commands that fit what is typed so far, best first:
 * 1. the command typed exactly,
 * 2. a command whose name is complete and is now getting parameters (the most
 *    specific name first), so its parameter signature stays visible,
 * 3. commands the input is still a beginning of.
 *
 * A line that starts with a space matches nothing. The console sends a line as
 * typed, and the firmware's `region load` reads the leading spaces as the
 * nesting depth of a region name; a completion would replace them.
 */
export function matchCliCommands(input: string, limit = 8): CliCommand[] {
  if (/^\s/.test(input)) return [];
  const q = input.toLowerCase().replace(/\s+/g, ' ');
  if (!q.trim()) return [];
  const typed = q.trimEnd();

  const scored: Array<{ cmd: CliCommand; rank: number; length: number }> = [];
  for (const cmd of CLI_COMMANDS) {
    const prefix = commandPrefix(cmd.syntax).toLowerCase();
    if (!prefix) continue;
    if (prefix === typed) scored.push({ cmd, rank: 0, length: prefix.length });
    else if (q.startsWith(`${prefix} `)) scored.push({ cmd, rank: 1, length: prefix.length });
    else if (prefix.startsWith(typed)) scored.push({ cmd, rank: 2, length: prefix.length });
  }

  return scored
    .sort((a, b) => a.rank - b.rank || (a.rank === 1 ? b.length - a.length : 0))
    .slice(0, limit)
    .map((entry) => entry.cmd);
}
