/**
 * The fleet vault session of this browser tab.
 *
 * The token is kept in memory only: not in localStorage, not in the URL. A
 * reload or a closed tab forgets it, and the server forgets it after it has
 * been idle (15 minutes) or on a restart. Components subscribe so every vault
 * section on screen locks and unlocks together.
 */
import { useSyncExternalStore } from 'react';

let token: string | null = null;
const listeners = new Set<() => void>();

export function getFleetVaultToken(): string | null {
  return token;
}

export function setFleetVaultToken(next: string | null): void {
  if (next === token) return;
  token = next;
  listeners.forEach((listener) => listener());
}

/** Request headers that carry the session, or none while locked. */
export function fleetVaultHeaders(): Record<string, string> {
  return token ? { 'X-Fleet-Vault-Token': token } : {};
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while this tab holds a vault token. The server may still have ended the session. */
export function useFleetVaultUnlocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => token !== null,
    () => false
  );
}
