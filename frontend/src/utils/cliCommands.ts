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
// - src/helpers/CommonCLI.cpp at repeater-v1.18.0: `power` and `gps diag` are new;
//   `room.post` (room server) and `extra.sf` (LR2021) are not on the docs page.
//
// The DMC firmware block (description ends in "(DMC)" or "(DMC observer)") is
// from Dutch-MeshCore/MeshCore at 0a96eae3; see the comment above that block.
// Stock firmware answers those with "Unknown command".
//
// COMPANION_CLI_COMMANDS below is the companion radio's own command line
// (firmware 1.18+), from companion-v1.18.0 examples/companion_radio/MyMesh.cpp
// (handleCommand) and src/helpers/CommonRadioPrefs.cpp, plus the meshcomod
// additions ("(meshcomod)"); "(not on meshcomod)" marks the settings meshcomod
// answers with "Error: unsupported".
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
  {
    category: 'Info',
    syntax: 'power',
    description: 'Battery mV and USB, solar, external power and charger state (1.18+)',
  },

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
  { category: 'GPS', syntax: 'gps diag', description: 'GPS diagnostics (1.18+)' },
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

  // repeater-v1.18.0, not on the docs page.
  {
    category: 'Room',
    syntax: 'room.post <message>',
    description: 'Post a system message to the room (room server)',
  },
  {
    category: 'Radio',
    syntax: 'get extra.sf',
    description: 'View extra side-detector SFs (LR2021)',
  },
  {
    category: 'Radio',
    syntax: 'set extra.sf <sf> [sf] [sf]',
    description: 'Set up to 3 extra side-detector SFs (LR2021)',
  },

  // ---- DMC firmware (Dutch-MeshCore dmc-dev / dmc-observer-dev) ----------------
  // From docs/cli_commands.md, docs/packet_filter_reference.md,
  // src/helpers/CommonCLI.cpp, src/helpers/CommonCLI_Observer.cpp and
  // examples/simple_repeater/Filter.cpp at 0a96eae3. Stock firmware answers
  // these with "Unknown command"; observer-only ones need an observer build.

  {
    category: 'DMC OTA',
    syntax: 'start ota ap',
    description: 'OTA upload page on its own hotspot (DMC)',
  },
  { category: 'DMC OTA', syntax: 'stop ota', description: 'Stop an idle OTA web server (DMC)' },
  {
    category: 'DMC OTA',
    syntax: 'ota check',
    description: 'Check for a newer build (DMC observer)',
  },
  {
    category: 'DMC OTA',
    syntax: 'ota update',
    description: 'Download, flash the newer build and reboot (DMC observer)',
  },
  {
    category: 'DMC OTA',
    syntax: 'ota branch',
    description: 'Show the OTA release channel (DMC observer)',
  },
  {
    category: 'DMC OTA',
    syntax: 'ota branch <prod|beta|default>',
    description: 'Pick the OTA release channel (DMC observer)',
  },
  {
    category: 'DMC Observer',
    syntax: 'start webconfig [ap]',
    description: 'Start the web config portal; ap forces the hotspot (DMC observer)',
  },
  {
    category: 'DMC Observer',
    syntax: 'stop webconfig',
    description: 'Stop the web config portal (DMC observer)',
  },
  { category: 'DMC Observer', syntax: 'memory', description: 'Heap and memory stats (DMC)' },
  {
    category: 'DMC Observer',
    syntax: 'stats-radio-diag',
    description: 'Radio diagnostics (DMC, serial only)',
  },
  {
    category: 'DMC Observer',
    syntax: 'tls.bundletest <host[:port]|url>',
    description: 'Test a TLS connection with the CA bundle (DMC observer)',
  },
  {
    category: 'DMC Observer',
    syntax: 'discover.scopes',
    description: 'Ask neighbors for their region scopes, publish to MQTT (DMC observer)',
  },
  {
    category: 'DMC Observer',
    syntax: 'get radio.watchdog',
    description: 'View radio watchdog minutes (DMC observer)',
  },
  {
    category: 'DMC Observer',
    syntax: 'set radio.watchdog <0-120>',
    description: 'Radio watchdog in minutes, 0 = off (DMC observer)',
  },
  {
    category: 'DMC Observer',
    syntax: 'get display.timeout',
    description: 'View display timeout (DMC observer)',
  },
  {
    category: 'DMC Observer',
    syntax: 'set display.timeout <0-3600>',
    description: 'Seconds before the display blanks, 0 = always on (DMC observer)',
  },
  {
    category: 'DMC Observer',
    syntax: 'get display.flip',
    description: 'View display rotation (DMC observer)',
  },
  {
    category: 'DMC Observer',
    syntax: 'set display.flip <on|off>',
    description: 'Rotate the display 180 degrees (DMC observer)',
  },
  {
    category: 'DMC Observer',
    syntax: 'get fan',
    description: 'Fan mode, temperature and state (DMC, T-Beam 1W)',
  },
  {
    category: 'DMC Observer',
    syntax: 'set fan <on|off|auto>',
    description: 'Set the fan mode (DMC, T-Beam 1W)',
  },
  {
    category: 'DMC Observer',
    syntax: 'set fan.lo <celsius>',
    description: 'Auto fan stop temperature (DMC)',
  },
  {
    category: 'DMC Observer',
    syntax: 'set fan.hi <celsius>',
    description: 'Auto fan start temperature (DMC)',
  },
  {
    category: 'DMC Routing',
    syntax: 'set dutycycle auto',
    description: 'Duty cycle limit from the frequency band (DMC)',
  },

  {
    category: 'DMC Duty gate',
    syntax: 'get dc.gate',
    description: 'Duty-cycle region gating on or off (DMC)',
  },
  {
    category: 'DMC Duty gate',
    syntax: 'set dc.gate <on|off>',
    description: 'Gate outer regions when the duty budget runs low (DMC)',
  },
  {
    category: 'DMC Duty gate',
    syntax: 'get dc.gate.thresh',
    description: 'View gating threshold % (DMC)',
  },
  {
    category: 'DMC Duty gate',
    syntax: 'set dc.gate.thresh <1-100>',
    description: '% of the duty budget used above which gating starts (DMC)',
  },
  {
    category: 'DMC Duty gate',
    syntax: 'get dc.gate.hyst',
    description: 'View gating hysteresis (DMC)',
  },
  {
    category: 'DMC Duty gate',
    syntax: 'set dc.gate.hyst <0-50>',
    description: 'Regions re-open below threshold minus this (DMC)',
  },
  {
    category: 'DMC Duty gate',
    syntax: 'get dc.gate.status',
    description: 'Current duty cycle and gate level (DMC)',
  },

  {
    category: 'DMC Filter',
    syntax: 'filter',
    description: 'Packet filter status and drops per reason (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter help',
    description: 'List every filter subcommand (DMC)',
  },
  { category: 'DMC Filter', syntax: 'filter on', description: 'Enable the packet filter (DMC)' },
  { category: 'DMC Filter', syntax: 'filter off', description: 'Disable the packet filter (DMC)' },
  {
    category: 'DMC Filter',
    syntax: 'filter reset',
    description: 'Restore default filter settings, counters kept (DMC)',
  },
  { category: 'DMC Filter', syntax: 'filter dryrun', description: 'View dry-run state (DMC)' },
  {
    category: 'DMC Filter',
    syntax: 'filter dryrun <on|off>',
    description: 'Count drops but keep forwarding (DMC)',
  },
  { category: 'DMC Filter', syntax: 'filter types', description: 'List packet type IDs (DMC)' },
  {
    category: 'DMC Filter',
    syntax: 'filter count',
    description: 'Hop and rate drops per packet type (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter stats',
    description: 'List the drop statistics topics (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter stats <hops|rate|channel|hash|malformed|top|advert|path|air|sender|text|age>',
    description: 'Drops for one topic (DMC)',
  },
  { category: 'DMC Filter', syntax: 'filter hops', description: 'View hop limits (DMC)' },
  {
    category: 'DMC Filter',
    syntax: 'filter hops <type> <max_hops>',
    description: 'Drop floods of a type at this many hops, 0-64 (DMC)',
  },
  { category: 'DMC Filter', syntax: 'filter rate', description: 'View rate limits (DMC)' },
  {
    category: 'DMC Filter',
    syntax: 'filter rate <type> <limit> <secs> [soft]',
    description: 'Rate limit a packet type, 0 = off (DMC)',
  },
  { category: 'DMC Filter', syntax: 'filter channel list', description: 'Blocked channels (DMC)' },
  {
    category: 'DMC Filter',
    syntax: 'filter channel add <#name|Public>',
    description: 'Block a channel, up to 16 (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter channel remove <#name|Public>',
    description: 'Unblock a channel (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter hash',
    description: 'View minimum path hash size (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter hash <1-3>',
    description: 'Drop floods with a smaller path hash (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter malformed',
    description: 'View malformed scan state (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter malformed <on|off>',
    description: 'Drop public group texts that are not valid UTF-8 (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter advert',
    description: 'View per-origin advert window (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter advert <0-720>',
    description: 'Forward each origin advert once per N hours, 0 = off (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter advert clear',
    description: 'Forget remembered advert origins (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter path list',
    description: 'Blocked path prefixes (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter path add <hex>',
    description: 'Block a path prefix, 2-8 hex digits (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter path remove <hex>',
    description: 'Unblock a path prefix (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter sender list',
    description: 'Sender rules in order (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter sender add <name> [secs] [prob]',
    description: 'Block, throttle or dose a sender; Bot* = prefix (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter sender remove <name>',
    description: 'Remove a sender rule (DMC)',
  },
  { category: 'DMC Filter', syntax: 'filter text list', description: 'Text rules in order (DMC)' },
  {
    category: 'DMC Filter',
    syntax: 'filter text add <pattern> [secs] [prob]',
    description: 'Block, throttle or dose matching text; ^ = starts with (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter text remove <pattern>',
    description: 'Remove a text rule (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter watch list',
    description: 'Channels the rules can read (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter watch add <#name>',
    description: 'Let the rules read this channel (DMC)',
  },
  {
    category: 'DMC Filter',
    syntax: 'filter watch remove <#name>',
    description: 'Stop reading this channel (DMC)',
  },
  { category: 'DMC Filter', syntax: 'filter age', description: 'View message age limit (DMC)' },
  {
    category: 'DMC Filter',
    syntax: 'filter age <minutes|off>',
    description: 'Drop group texts older than this, 1-10080 min (DMC)',
  },

  { category: 'DMC SNMP', syntax: 'get snmp', description: 'SNMP agent on or off (DMC observer)' },
  {
    category: 'DMC SNMP',
    syntax: 'set snmp <on|off>',
    description: 'Turn the SNMP agent on or off, restart to apply (DMC observer)',
  },
  {
    category: 'DMC SNMP',
    syntax: 'get snmp.community',
    description: 'View SNMP community (DMC observer)',
  },
  {
    category: 'DMC SNMP',
    syntax: 'set snmp.community <string>',
    description: 'Set SNMP community, restart to apply (DMC observer)',
  },

  {
    category: 'DMC WiFi',
    syntax: 'get wifi.ssid',
    description: 'View WiFi network name (DMC observer)',
  },
  {
    category: 'DMC WiFi',
    syntax: 'set wifi.ssid <ssid>',
    description: 'Set WiFi network name (DMC observer)',
  },
  {
    category: 'DMC WiFi',
    syntax: 'get wifi.pwd',
    description: 'WiFi password; remote sees set/unset only (DMC observer)',
  },
  {
    category: 'DMC WiFi',
    syntax: 'set wifi.pwd <password>',
    description: 'Set WiFi password (DMC observer)',
  },
  {
    category: 'DMC WiFi',
    syntax: 'get wifi.status',
    description: 'WiFi state and IP address (DMC observer)',
  },
  {
    category: 'DMC WiFi',
    syntax: 'get wifi.powersave',
    description: 'View WiFi power save (DMC observer)',
  },
  {
    category: 'DMC WiFi',
    syntax: 'set wifi.powersave <none|min|max>',
    description: 'Set WiFi power save (DMC observer)',
  },
  {
    category: 'DMC WiFi',
    syntax: 'get link.status',
    description: 'Network link state (DMC observer)',
  },
  {
    category: 'DMC WiFi',
    syntax: 'get link.diag',
    description: 'Network link diagnostics (DMC observer)',
  },
  {
    category: 'DMC WiFi',
    syntax: 'get link.dns',
    description: 'DNS servers in use (DMC observer)',
  },
  { category: 'DMC Time', syntax: 'get timezone', description: 'View timezone (DMC observer)' },
  { category: 'DMC Time', syntax: 'set timezone <tz>', description: 'Set timezone (DMC observer)' },
  {
    category: 'DMC Time',
    syntax: 'get timezone.offset',
    description: 'View UTC offset (DMC observer)',
  },
  {
    category: 'DMC Time',
    syntax: 'set timezone.offset <-12..14>',
    description: 'Set UTC offset in hours (DMC observer)',
  },

  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.stats',
    description: 'MQTT bridge statistics (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.presets [start]',
    description: 'List broker presets (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.iata',
    description: 'View region (IATA) code (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.iata <code>',
    description: 'Region code for topics, 3 letters/digits (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.origin',
    description: 'View origin name (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.origin [name]',
    description: 'Set origin name, empty clears it (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.status',
    description: 'Status topic on or off (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.status <on|off>',
    description: 'Publish the status topic (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.packets',
    description: 'Packets topic on or off (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.packets <on|off>',
    description: 'Publish the packets topic (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.raw',
    description: 'Raw topic on or off (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.raw <on|off>',
    description: 'Publish the raw topic (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.rx',
    description: 'RX packet uplink on or off (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.rx <on|off>',
    description: 'Uplink received packets (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.tx',
    description: 'TX packet uplink setting (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.tx <on|off|advert>',
    description: 'Uplink sent packets, or adverts only (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.advert.verify',
    description: 'Advert signature check on or off (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.advert.verify <on|off>',
    description: 'Only uplink adverts with a valid signature (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.interval',
    description: 'View status interval (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.interval <1-60>',
    description: 'Status publish interval in minutes (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.filter.interval',
    description: 'View filter-stats interval (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.filter.interval <seconds>',
    description: 'Filter-stats publish interval, 0 = off, 60-600 s (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.neighbors',
    description: 'Neighbors publishing on or off (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.neighbors <on|off>',
    description: 'Publish the neighbor table periodically (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.neighbors.interval',
    description: 'View neighbors interval (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.neighbors.interval <12-336>',
    description: 'Neighbors publish interval in hours (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.config',
    description: 'Config topic on or off (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.config <on|off>',
    description: 'Publish the node config topic (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.config.valid',
    description: 'Check the MQTT config is complete (DMC observer)',
  },
  { category: 'DMC MQTT', syntax: 'get mqtt.ntp', description: 'View NTP server (DMC observer)' },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.ntp <hostname|none>',
    description: 'Set NTP server, none clears it (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.ntp.diag',
    description: 'Test NTP server reachability (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.analyzer.us',
    description: 'US analyzer preset on slot 1 (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.analyzer.us <on|off>',
    description: 'Put the US analyzer on slot 1 (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.analyzer.eu',
    description: 'EU analyzer preset on slot 2 (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.analyzer.eu <on|off>',
    description: 'Put the EU analyzer on slot 2 (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.owner',
    description: 'Owner public key (DMC observer, serial only)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.owner [public_key]',
    description: 'Owner public key, 64 hex, empty clears (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt.email',
    description: 'Owner email (DMC observer, serial only)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt.email <email>',
    description: 'Owner email (DMC observer)',
  },
  // Broker slots: mqtt1 to mqtt6 take the same keys; slot 1 stands in for all.
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.preset',
    description: 'Broker preset of a slot, mqtt1-6 (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt1.preset <name>',
    description: 'Broker preset for a slot, see get mqtt.presets (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.server',
    description: 'Broker host of a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt1.server <host>',
    description: 'Broker host for a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.port',
    description: 'Broker port of a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt1.port <1-65535>',
    description: 'Broker port for a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.username',
    description: 'Broker username of a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt1.username <name>',
    description: 'Broker username for a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.password',
    description: 'Broker password; remote sees set/unset (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt1.password <password>',
    description: 'Broker password for a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.token',
    description: 'Broker token; remote sees set/unset (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt1.token <token>',
    description: 'Broker token for a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.topic',
    description: 'Topic template of a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt1.topic <template>',
    description: 'Topic template, custom preset only (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.audience',
    description: 'Token audience of a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt1.audience [audience]',
    description: 'Token audience, empty clears (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.filter',
    description: 'Packet types a slot gets (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt1.filter <all|none|types>',
    description: 'Packet types for a slot, CSV of 0-15 or names (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.extras',
    description: 'DMC extra topics of a slot (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'set mqtt1.extras <none|filter|config|all>',
    description: 'Which DMC extra topics a slot gets (DMC observer)',
  },
  {
    category: 'DMC MQTT',
    syntax: 'get mqtt1.diag',
    description: 'Connection diagnostics of a slot (DMC observer)',
  },

  {
    category: 'DMC Alerts',
    syntax: 'get alert',
    description: 'Fault alerts on or off (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'set alert <on|off>',
    description: 'Send fault alerts to a channel (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'get alert.psk',
    description: 'Alert channel key (DMC observer, serial only)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'set alert.psk [hex]',
    description: 'Alert channel key, 32 hex; empty clears (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'get alert.hashtag',
    description: 'Alert hashtag channel (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'set alert.hashtag [#name]',
    description: 'Send alerts on this hashtag channel (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'get alert.region',
    description: 'Alert scope region (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'set alert.region [name]',
    description: 'Region for alert floods, empty = default scope (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'get alert.wifi',
    description: 'WiFi-down alert delay (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'set alert.wifi <0-1440>',
    description: 'Alert after WiFi is down this many minutes, 0 = off (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'get alert.mqtt',
    description: 'MQTT-down alert delay (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'set alert.mqtt <0-10080>',
    description: 'Alert after MQTT is down this many minutes, 0 = off (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'get alert.interval',
    description: 'Minimum time between alerts (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'set alert.interval <60-10080>',
    description: 'Minimum minutes between alerts (DMC observer)',
  },
  {
    category: 'DMC Alerts',
    syntax: 'alert test',
    description: 'Send one test alert now, transmits (DMC observer)',
  },
];

// The companion radio's own command line (firmware 1.18+, CMD_RUN_CLI_COMMAND),
// also reachable from another companion that has Remote CLI permission.
// wifi.* only exist on WiFi-capable builds; boards may add their own commands
// (MainBoard::handleCommand), such as radio.fem.rxgain.
export const COMPANION_CLI_COMMANDS: CliCommand[] = [
  { category: 'Operational', syntax: 'reboot', description: 'Restart the radio' },
  { category: 'Operational', syntax: 'poweroff', description: 'Turn off the radio' },
  { category: 'Operational', syntax: 'shutdown', description: 'Turn off the radio' },
  { category: 'Info', syntax: 'ver', description: 'Firmware version and build date' },
  { category: 'Info', syntax: 'board', description: 'Board manufacturer name' },
  { category: 'Identity', syntax: 'get name', description: 'Node name' },
  { category: 'Identity', syntax: 'set name <name>', description: 'Set the node name' },
  { category: 'Identity', syntax: 'set pin <pin>', description: 'Set the BLE pairing PIN' },
  { category: 'Time', syntax: 'get tz.offset', description: 'Time zone offset in hours' },
  {
    category: 'Time',
    syntax: 'set tz.offset <hours>',
    description: 'Set the time zone offset (-12 to +14)',
  },
  { category: 'Radio', syntax: 'get radio', description: 'freq,bw,sf,cr' },
  {
    category: 'Radio',
    syntax: 'set radio <freq>,<bw>,<sf>,<cr>',
    description: 'Set radio parameters (reboot to apply)',
  },
  { category: 'Radio', syntax: 'get freq', description: 'Frequency in MHz' },
  { category: 'Radio', syntax: 'get tx', description: 'TX power in dBm' },
  { category: 'Radio', syntax: 'set tx <dbm>', description: 'Set TX power' },
  { category: 'Radio', syntax: 'get af', description: 'Airtime factor' },
  { category: 'Radio', syntax: 'set af <0-9>', description: 'Set airtime factor' },
  { category: 'Radio', syntax: 'get dutycycle', description: 'Duty cycle limit in %' },
  { category: 'Radio', syntax: 'set dutycycle <1-100>', description: 'Set duty cycle limit' },
  {
    category: 'Radio',
    syntax: 'get int.thresh',
    description: 'Interference threshold (not on meshcomod)',
  },
  {
    category: 'Radio',
    syntax: 'set int.thresh <value>',
    description: 'Set interference threshold (not on meshcomod)',
  },
  {
    category: 'Radio',
    syntax: 'get cad',
    description: 'Channel activity detection before TX (not on meshcomod)',
  },
  {
    category: 'Radio',
    syntax: 'set cad <on|off>',
    description: 'Turn CAD on or off (not on meshcomod)',
  },
  { category: 'Radio', syntax: 'get radio.rxgain', description: 'RX boosted gain' },
  {
    category: 'Radio',
    syntax: 'set radio.rxgain <on|off>',
    description: 'Turn RX boosted gain on or off',
  },
  { category: 'Radio', syntax: 'get rxdelay', description: 'RX delay base' },
  { category: 'Radio', syntax: 'set rxdelay <0-20>', description: 'Set RX delay base' },
  {
    category: 'Radio',
    syntax: 'get txdelay',
    description: 'Flood TX delay factor (not on meshcomod)',
  },
  {
    category: 'Radio',
    syntax: 'set txdelay <0-2>',
    description: 'Set flood TX delay factor (not on meshcomod)',
  },
  {
    category: 'Radio',
    syntax: 'get direct.txdelay',
    description: 'Direct TX delay factor (not on meshcomod)',
  },
  {
    category: 'Radio',
    syntax: 'set direct.txdelay <0-2>',
    description: 'Set direct TX delay factor (not on meshcomod)',
  },
  {
    category: 'Radio',
    syntax: 'get agc.reset.interval',
    description: 'AGC reset interval in seconds (not on meshcomod)',
  },
  {
    category: 'Radio',
    syntax: 'set agc.reset.interval <0-1020>',
    description: 'Set AGC reset interval (multiple of 4) (not on meshcomod)',
  },
  {
    category: 'Radio',
    syntax: 'get path.hash.mode',
    description: 'Path hash size mode (0, 1 or 2)',
  },
  { category: 'Radio', syntax: 'set path.hash.mode <0-2>', description: 'Set path hash size mode' },
  { category: 'Radio', syntax: 'get multi.acks', description: 'Extra ACK transmissions' },
  { category: 'Radio', syntax: 'set multi.acks <n>', description: 'Set extra ACK transmissions' },
  { category: 'WiFi', syntax: 'get wifi.ssid', description: 'WiFi network name' },
  {
    category: 'WiFi',
    syntax: 'set wifi.ssid <ssid>',
    description: 'Set WiFi network (reboot to apply)',
  },
  {
    category: 'WiFi',
    syntax: 'set wifi.pwd <password>',
    description: 'Set WiFi password (reboot to apply)',
  },
  { category: 'WiFi', syntax: 'get wifi.pwd', description: 'Show the WiFi password' },
  { category: 'WiFi', syntax: 'set wifi.clear', description: 'Forget the WiFi settings' },
  { category: 'WiFi', syntax: 'get wifi.enabled', description: 'WiFi on or off' },
  {
    category: 'WiFi',
    syntax: 'set wifi.enabled <0|1>',
    description: 'Turn WiFi on or off (reboot to apply)',
  },
  { category: 'WiFi', syntax: 'get wifi.status', description: 'WiFi connected or not' },
  { category: 'WiFi', syntax: 'get wifi.ip', description: 'WiFi IP address' },
  // meshcomod (Elektr0Vodka/meshcomod main 938352fa): examples/companion_radio
  // MyMesh.cpp handleCommand, CompanionSNMP.cpp, CompanionFilter.cpp and
  // docs/companion_snmp.md, docs/companion_receive_filter.md.
  {
    category: 'WiFi',
    syntax: 'wifi.apply',
    description: 'Reconnect with the saved WiFi settings (meshcomod)',
  },
  { category: 'SNMP', syntax: 'get snmp', description: 'SNMP agent on or off (meshcomod)' },
  {
    category: 'SNMP',
    syntax: 'set snmp <on|off>',
    description: 'Turn the SNMP agent on or off, applies live (meshcomod)',
  },
  {
    category: 'SNMP',
    syntax: 'get snmp.status',
    description: 'Running, waiting for WiFi, or off (meshcomod)',
  },
  {
    category: 'SNMP',
    syntax: 'get snmp.community',
    description: 'SNMP community, local only (meshcomod)',
  },
  {
    category: 'SNMP',
    syntax: 'set snmp.community <string>',
    description: 'Set SNMP community, 1-23 chars (meshcomod)',
  },
  { category: 'Filter', syntax: 'filter', description: 'Receive filter status (meshcomod)' },
  {
    category: 'Filter',
    syntax: 'filter help',
    description: 'List the filter subcommands (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter on',
    description: 'Turn the receive filter on (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter off',
    description: 'Turn the receive filter off (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter reset',
    description: 'Clear the filter settings, totals kept (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter malformed',
    description: 'Malformed scan state (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter malformed <on|off>',
    description: 'Drop malformed group texts (meshcomod)',
  },
  { category: 'Filter', syntax: 'filter age', description: 'Message age limit (meshcomod)' },
  {
    category: 'Filter',
    syntax: 'filter age <minutes|off>',
    description: 'Drop group texts older than this, 1-10080 min (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter path list',
    description: 'Blocked path prefixes (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter path add <hex>',
    description: 'Block a path prefix, 2-8 hex digits (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter path remove <hex>',
    description: 'Unblock a path prefix (meshcomod)',
  },
  { category: 'Filter', syntax: 'filter sender list', description: 'Sender rules (meshcomod)' },
  {
    category: 'Filter',
    syntax: 'filter sender add <name> [secs] [prob]',
    description: 'Hide or throttle a sender; Bot* = prefix (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter sender remove <name>',
    description: 'Remove a sender rule (meshcomod)',
  },
  { category: 'Filter', syntax: 'filter text list', description: 'Text rules (meshcomod)' },
  {
    category: 'Filter',
    syntax: 'filter text add <pattern> [secs] [prob]',
    description: 'Hide or throttle matching text; ^ = starts with (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter text remove <pattern>',
    description: 'Remove a text rule (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter stats',
    description: 'Hidden and dropped totals (meshcomod)',
  },
  {
    category: 'Filter',
    syntax: 'filter stats <malformed|age|path|sender|text>',
    description: 'Totals for one reason (meshcomod)',
  },
];

// meshcomod's own commands (Elektr0Vodka/meshcomod 5c01ff21, examples/companion_radio
// MyMesh.cpp handleMeshcomodCommand / kMeshcomodHelpMsg). The 1.18 command line
// answers them with "Unknown command": the backend sends them to the "Meshcomod"
// command contact instead, so they only work on our own meshcomod radio and the
// console offers them only there.
export const MESHCOMOD_CONTACT_CLI_COMMANDS: CliCommand[] = [
  { category: 'Info', syntax: 'help', description: 'List the meshcomod commands (meshcomod)' },
  {
    category: 'Info',
    syntax: 'status',
    description: 'USB, BLE, TCP, WebSocket and WiFi state (meshcomod)',
  },
  { category: 'Info', syntax: 'mac', description: 'WiFi and BLE MAC addresses (meshcomod)' },
  {
    category: 'OTA',
    syntax: 'ota check',
    description: 'Ask the OTA server for a newer build (meshcomod)',
  },
  {
    category: 'OTA',
    syntax: 'ota update',
    description: 'Install the newer build from the OTA server (meshcomod)',
  },
  {
    category: 'OTA',
    syntax: 'ota url <https://...bin>',
    description: 'Flash the firmware at this URL (meshcomod)',
  },
  { category: 'OTA', syntax: 'ota status', description: 'OTA progress or idle (meshcomod)' },
  { category: 'OTA', syntax: 'ota start', description: 'Start the local OTA mode (meshcomod)' },
  {
    category: 'OTA',
    syntax: 'ota netdiag',
    description: 'Network checks for HTTP OTA (meshcomod)',
  },
  { category: 'WiFi', syntax: 'wifi status', description: 'WiFi settings and state (meshcomod)' },
  {
    category: 'WiFi',
    syntax: 'wifi scan',
    description: 'List nearby 2.4 GHz networks (meshcomod)',
  },
  {
    category: 'WiFi',
    syntax: 'wifi use <n>',
    description: 'Pick a network from the last scan (meshcomod)',
  },
  {
    category: 'WiFi',
    syntax: 'wifi set ssid <ssid>',
    description: 'Set the WiFi network (meshcomod)',
  },
  {
    category: 'WiFi',
    syntax: 'wifi set pwd <password>',
    description: 'Set the WiFi password (meshcomod)',
  },
  {
    category: 'WiFi',
    syntax: 'wifi apply',
    description: 'Connect with the WiFi settings (meshcomod)',
  },
  { category: 'WiFi', syntax: 'wifi on', description: 'Turn the WiFi radio on (meshcomod)' },
  { category: 'WiFi', syntax: 'wifi off', description: 'Turn the WiFi radio off (meshcomod)' },
  { category: 'WiFi', syntax: 'wifi clear', description: 'Forget the WiFi settings (meshcomod)' },
  {
    category: 'Connections',
    syntax: 'tcp status',
    description: 'TCP server on or off (meshcomod)',
  },
  { category: 'Connections', syntax: 'tcp on', description: 'Turn the TCP server on (meshcomod)' },
  {
    category: 'Connections',
    syntax: 'tcp off',
    description: 'Turn the TCP server off, asks for ok (meshcomod)',
  },
  {
    category: 'Connections',
    syntax: 'ble status',
    description: 'BLE on or off, and the peer (meshcomod)',
  },
  { category: 'Connections', syntax: 'ble on', description: 'Turn BLE on (meshcomod)' },
  {
    category: 'Connections',
    syntax: 'ble off',
    description: 'Turn BLE off, asks for ok (meshcomod)',
  },
  {
    category: 'Connections',
    syntax: 'ok',
    description: 'Confirm tcp off or ble off within 30 s (meshcomod)',
  },
  { category: 'Connections', syntax: 'cancel', description: 'Keep TCP or BLE on (meshcomod)' },
];

// `set\s+radio\s` (radio followed by a space) so the harmless `set radio.rxgain`
// does not match. meshcomod's `wifi off|apply|clear` drop or move WiFi and
// `ota update|url|start` flash or reboot the radio; `tcp off` / `ble off` are
// left out because the firmware itself asks for an `ok`.
const RISKY_COMPANION_RE =
  /^\s*(?:[0-9A-Fa-f]{2}\|)?\s*(?:reboot\b|poweroff\b|shutdown\b|set\s+radio\s|set\s+pin\b|set\s+wifi\.|wifi\.(?:apply|clear)\b|wifi\s+(?:off|apply|clear)\b|ota\s+(?:update|url|start)\b)/i;

/** Commands that cut the connection, change RF or change access: ask first. */
export function isRiskyCompanionCommand(command: string): boolean {
  return RISKY_COMPANION_RE.test(command);
}

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
export function matchCliCommands(
  input: string,
  limit = 8,
  commands: CliCommand[] = CLI_COMMANDS
): CliCommand[] {
  if (/^\s/.test(input)) return [];
  const q = input.toLowerCase().replace(/\s+/g, ' ');
  if (!q.trim()) return [];
  const typed = q.trimEnd();

  const scored: Array<{ cmd: CliCommand; rank: number; length: number }> = [];
  for (const cmd of commands) {
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
