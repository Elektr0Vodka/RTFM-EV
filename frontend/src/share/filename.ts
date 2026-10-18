const pad = (n: number) => String(n).padStart(2, '0');

/** `rtfm-ev-<kind>-YYYY-MM-DD-HHmm` in local time, without extension. */
export function shareFilename(kind: string, when: Date): string {
  return (
    `rtfm-ev-${kind}-${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-` +
    `${pad(when.getHours())}${pad(when.getMinutes())}`
  );
}
