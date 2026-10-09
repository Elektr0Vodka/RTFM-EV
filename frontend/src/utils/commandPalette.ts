/**
 * Lets a button elsewhere in the shell open the command palette, which owns its
 * own open state and otherwise only opens on Ctrl+K / Cmd+K.
 */
export const COMMAND_PALETTE_OPEN_EVENT = 'rtfm-command-palette-open';

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
}
