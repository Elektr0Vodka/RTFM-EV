/**
 * A fake 2D canvas context that records calls, for testing share-card drawing
 * in jsdom (which has no canvas). `measureText` is 10 px per grapheme.
 */
export interface RecordedCall {
  name: string;
  args: unknown[];
}

export type RecordingCtx = CanvasRenderingContext2D & {
  calls: (name?: string) => RecordedCall[];
  texts: () => string[];
};

export function recordingCtx(): RecordingCtx {
  const log: RecordedCall[] = [];
  const state: Record<string | symbol, unknown> = {
    canvas: { width: 1200, height: 630 },
  };
  const handler: ProxyHandler<Record<string | symbol, unknown>> = {
    get(target, prop) {
      if (prop === 'calls')
        return (name?: string) => (name ? log.filter((c) => c.name === name) : log);
      if (prop === 'texts')
        return () => log.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
      if (prop === 'measureText')
        return (s: string) => {
          log.push({ name: 'measureText', args: [s] });
          return { width: Array.from(s).length * 10 };
        };
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        log.push({ name: String(prop), args });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
          return { addColorStop: () => {} };
        return undefined;
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      log.push({ name: `set:${String(prop)}`, args: [value] });
      return true;
    },
  };
  return new Proxy(state, handler) as unknown as RecordingCtx;
}
