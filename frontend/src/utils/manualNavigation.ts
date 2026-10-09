/**
 * Ask the User Guide to open at a section. The guide is one page (`#manual`)
 * and the URL hash drives the app's routing, so the section travels here
 * instead: the caller requests it and navigates to the guide; `ManualView`
 * takes it when it mounts, or right away when it is already open.
 */
export const MANUAL_SECTION_EVENT = 'rtfm-manual-section';

let pending: string | null = null;

export function requestManualSection(sectionId: string): void {
  pending = sectionId;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MANUAL_SECTION_EVENT));
}

/** The requested section, once; null when none is waiting. */
export function takeManualSection(): string | null {
  const sectionId = pending;
  pending = null;
  return sectionId;
}
