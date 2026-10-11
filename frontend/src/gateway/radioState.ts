import type { RadioState } from './api';

/** Worker state as shown in the switcher and on the radios page. */
export const RADIO_STATE_LABEL: Record<RadioState, string> = {
  running: 'gateway_state_running',
  starting: 'gateway_state_starting',
  stopped: 'gateway_state_stopped',
  crashed: 'gateway_state_crashed',
};

export const RADIO_STATE_DOT: Record<RadioState, string> = {
  running: 'bg-status-connected',
  starting: 'bg-warning',
  stopped: 'bg-muted-foreground/50',
  crashed: 'bg-destructive',
};
