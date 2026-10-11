/**
 * Where the buddy and the walkthrough panel go for a stop. Pure geometry in
 * viewport px, so it can be tested without a layout engine.
 */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Spot {
  x: number;
  y: number;
}

/** Space between the target and the buddy, and between the buddy and the panel. */
const GAP_PX = 12;
/** Space kept to the screen edge. */
const EDGE_PX = 8;
/** A target this close to the top or bottom edge (share of the height) sits in a bar. */
const BAR_BAND = 0.1;

type Side = 'right' | 'left' | 'below' | 'above';
/** Along the side: centred on the anchor, or flush with its start or end edge. */
type Align = 'centre' | 'start' | 'end';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

function beside(anchor: Box, size: Size, side: Side, viewport: Size, align: Align = 'centre'): Box {
  const along = (start: number, length: number, own: number) =>
    align === 'start' ? start : align === 'end' ? start + length - own : start + (length - own) / 2;
  const maxLeft = Math.max(EDGE_PX, viewport.width - size.width - EDGE_PX);
  const maxTop = Math.max(EDGE_PX, viewport.height - size.height - EDGE_PX);
  const left = clamp(along(anchor.left, anchor.width, size.width), EDGE_PX, maxLeft);
  const top = clamp(along(anchor.top, anchor.height, size.height), EDGE_PX, maxTop);
  switch (side) {
    case 'right':
      return { ...size, left: anchor.left + anchor.width + GAP_PX, top };
    case 'left':
      return { ...size, left: anchor.left - GAP_PX - size.width, top };
    case 'below':
      return { ...size, left, top: anchor.top + anchor.height + GAP_PX };
    case 'above':
      return { ...size, left, top: anchor.top - GAP_PX - size.height };
  }
}

function onScreen(box: Box, viewport: Size): boolean {
  return (
    box.left >= EDGE_PX &&
    box.top >= EDGE_PX &&
    box.left + box.width <= viewport.width - EDGE_PX &&
    box.top + box.height <= viewport.height - EDGE_PX
  );
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

function intoView(box: Box, viewport: Size): Box {
  return {
    ...box,
    left: clamp(box.left, EDGE_PX, Math.max(EDGE_PX, viewport.width - box.width - EDGE_PX)),
    top: clamp(box.top, EDGE_PX, Math.max(EDGE_PX, viewport.height - box.height - EDGE_PX)),
  };
}

/**
 * Where the buddy stands for a target: beside it, never on it. A wide target
 * or one in a bar at the top or bottom gets the buddy under or over it; any
 * other gets it to the side with the most room. `around` is the bar or panel
 * the target is part of (the sidebar for one of its rows): the buddy stands
 * outside that too when it can, so it does not cover the neighbours of what
 * it points at. When no side has room for the whole buddy it takes the
 * roomiest side and is pushed back on screen (it then covers part of the
 * target; that only happens when the target fills the screen).
 */
export function placeBuddy(
  target: Box,
  buddy: Size,
  viewport: Size,
  around: Box | null = null
): Spot {
  const room: Record<Side, number> = {
    right: viewport.width - (target.left + target.width),
    left: target.left,
    below: viewport.height - (target.top + target.height),
    above: target.top,
  };
  const centreY = target.top + target.height / 2;
  const inBar = centreY < viewport.height * BAR_BAND || centreY > viewport.height * (1 - BAR_BAND);
  const vertical = target.width >= viewport.width / 2 || inBar;
  const roomier = (a: Side, b: Side): Side[] => (room[a] >= room[b] ? [a, b] : [b, a]);
  const order = vertical
    ? [...roomier('below', 'above'), ...roomier('right', 'left')]
    : [...roomier('right', 'left'), ...roomier('below', 'above')];
  const fits = order
    .map((side) => beside(target, buddy, side, viewport))
    .filter((box) => onScreen(box, viewport));
  const spot =
    (around && fits.find((box) => !boxesOverlap(box, around))) ??
    fits[0] ??
    intoView(beside(target, buddy, order[0], viewport), viewport);
  return { x: spot.left, y: spot.top };
}

/**
 * Where the panel goes: next to the buddy, on screen, clear of the target when
 * there is one. Sides away from the target are tried first, each centred on
 * the buddy and then flush with either of its edges (on a narrow screen that
 * is what gets it past a target next to the buddy). With no free spot it is
 * pushed back on screen next to the buddy.
 */
export function placePanel(buddy: Box, panel: Size, viewport: Size, target: Box | null): Spot {
  const sides: Side[] = ['above', 'left', 'below', 'right'];
  if (target) {
    const awayX = buddy.left + buddy.width / 2 - (target.left + target.width / 2);
    const awayY = buddy.top + buddy.height / 2 - (target.top + target.height / 2);
    const score: Record<Side, number> = {
      right: awayX,
      left: -awayX,
      below: awayY,
      above: -awayY,
    };
    sides.sort((a, b) => score[b] - score[a]);
  }
  const aligns: Align[] = ['centre', 'start', 'end'];
  const boxes = sides.flatMap((side) =>
    aligns.map((align) => beside(buddy, panel, side, viewport, align))
  );
  const free =
    boxes.find((box) => onScreen(box, viewport) && !(target && boxesOverlap(box, target))) ??
    boxes.find((box) => onScreen(box, viewport)) ??
    intoView(boxes[0], viewport);
  return { x: free.left, y: free.top };
}
