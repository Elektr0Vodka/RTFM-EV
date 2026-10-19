/**
 * Projects behind GRP_DATA data types, for the chat placeholder of a channel
 * datagram RTFM-EV does not decode. Sources: MeshCore's
 * `docs/number_allocations.md` plus types the projects use on their own
 * (research report 2026-10-19, section 3). 0xFFFF is left out on purpose:
 * MeshCore SAR and MeshCore Companion share it, told apart only by content.
 */
const RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [0x0100, 0x0100, 'MeshCore Open'],
  [0x0110, 0x011f, 'Ripple'],
  [0x0120, 0x0120, 'MCO Advanced'],
  [0x0130, 0x013f, 'StreamSensor'],
  [0x0140, 0x0140, 'Nelos'],
  [0x0200, 0x0200, 'MeshCoreNG'],
  [0x4447, 0x4447, 'Trail Mate'], // "GD": Trail Mate sends no data_type header
  [0xae1c, 0xae1c, 'MeshCore Open'],
  [0xff01, 0xff02, 'TAK-MESHCORE'],
  [0xfff0, 0xfff1, 'MCO Advanced'], // legacy MCOimg / MCMP
];

export function groupDataOwner(dataType: number): string | null {
  for (const [low, high, owner] of RANGES) {
    if (dataType >= low && dataType <= high) return owner;
  }
  return null;
}
