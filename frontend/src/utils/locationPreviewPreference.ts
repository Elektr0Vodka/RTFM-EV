// Browser-local preference for showing a small inline map preview under a shared
// location (MeshCore Open marker payloads) in the chat. Off by default: each
// preview mounts a Leaflet map and fetches map tiles, so it is opt-in.

export const LOCATION_MAP_PREVIEW_KEY = 'remoteterm-location-map-preview';

export function getSavedLocationMapPreview(): boolean {
  try {
    return localStorage.getItem(LOCATION_MAP_PREVIEW_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSavedLocationMapPreview(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(LOCATION_MAP_PREVIEW_KEY, 'true');
    } else {
      localStorage.removeItem(LOCATION_MAP_PREVIEW_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
}
