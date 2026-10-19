import type { TrackerObject, TrackerPosition } from '../types';

/** WS `tracker` event: a newly decoded ATAK / MeshCore SAR position or ATAK map object. */
export type TrackerEventPayload =
  { kind: 'position'; data: TrackerPosition } | { kind: 'object'; data: TrackerObject };

/**
 * Browser-local fan-out for the WS `tracker` event, so the map's Trackers layer
 * updates live without threading a handler through App.
 */
const EVENT_NAME = 'rtfm:tracker';

export function emitTrackerEvent(payload: TrackerEventPayload): void {
  window.dispatchEvent(new CustomEvent<TrackerEventPayload>(EVENT_NAME, { detail: payload }));
}

export function subscribeTrackerEvents(
  handler: (payload: TrackerEventPayload) => void
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<TrackerEventPayload>).detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
