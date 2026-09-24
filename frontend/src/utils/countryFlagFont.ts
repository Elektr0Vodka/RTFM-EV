// Whether main.tsx injected the bundled "Twemoji Country Flags" font because the
// browser has color emoji but no regional-indicator flags (Windows/Chromium).
let countryFlagFontActive = false;

export function setCountryFlagFontActive(active: boolean): void {
  countryFlagFontActive = active;
}

export function isCountryFlagFontActive(): boolean {
  return countryFlagFontActive;
}
