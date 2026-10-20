import type { CSSProperties } from 'react';

/** Padding for the page's bottom sheets. The sheet's safe-area inline style
 * replaces the sides of its `p-6`, so the sides are set here: at least 1rem,
 * more where the phone has an inset. */
export const BOTTOM_SHEET_STYLE: CSSProperties = {
  paddingLeft: 'max(1rem, var(--safe-area-left, 0px))',
  paddingRight: 'max(1rem, var(--safe-area-right, 0px))',
  paddingBottom: 'max(1rem, var(--safe-area-bottom, 0px))',
};
