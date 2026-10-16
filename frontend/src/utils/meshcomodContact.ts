/**
 * meshcomod's built-in "Meshcomod" contact. meshcomod companion firmware lists
 * it after every contact sync, with the key "MESHCM" padded with zeros. A DM to
 * it runs on the radio itself (wifi, tcp, ble, ota, status) and never goes out
 * over LoRa; the radio answers with plain DMs. Mirrors app/meshcomod_contact.py.
 */
export const MESHCOMOD_COMMAND_CONTACT_PREFIX = '4d455348434d';

export function isMeshcomodCommandContact(publicKey: string | null | undefined): boolean {
  return !!publicKey && publicKey.toLowerCase().startsWith(MESHCOMOD_COMMAND_CONTACT_PREFIX);
}

/** One-tap commands in the chat; each only fills the message box. */
export const MESHCOMOD_QUICK_COMMANDS = ['help', 'status', 'wifi status', 'ota check'] as const;

/**
 * Commands that restart the radio or can cut this app off from it. The radio
 * itself also asks for "ok" after `tcp off` and `ble off`.
 */
const RISKY_COMMANDS = [
  'reboot',
  'bootloader',
  'dfu',
  'ota update',
  'ota start',
  'ota url',
  'wifi off',
  'wifi clear',
  'tcp off',
  'ble off',
];

/** True when `text` starts with one of the risky commands (any case, any spacing). */
export function isRiskyMeshcomodCommand(text: string): boolean {
  const command = text.trim().toLowerCase().split(/\s+/).join(' ');
  return RISKY_COMMANDS.some((risky) => command === risky || command.startsWith(`${risky} `));
}
