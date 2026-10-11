import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltips for touch screens.
 *
 * Most explanations in this app hang off a native `title`: what a badge means,
 * the full value of a shortened one, when something was last heard. A mouse
 * shows those on hover; a finger never does. This layer shows the title in a
 * bubble when such an element is tapped, from one listener on the document
 * instead of a wrapper at each title.
 *
 * It only acts on touch and pen input. A mouse keeps the native tooltip and
 * gets nothing extra. It also leaves alone anything that already answers a
 * press (buttons, links, inputs, `role="button"` and the like): tapping those
 * does what they are for.
 *
 * Adapted from the tristandostaler/Remote-Terminal-for-MeshCore fork
 * (`8c57cb46`), without its long-press and mouse-click handling.
 */

const TOOLTIP_ID = 'tap-tooltip';

// React attaches its handlers at the root, so there is nothing on a node to
// tell that it is clickable. Roles and tags are the only signal available.
const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'label',
  '[role="button"]',
  '[role="link"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * The titled element a tap should explain, or null when the tap belongs to
 * something else. `data-no-tap-tooltip` on an ancestor opts a subtree out.
 */
export function tapTooltipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const titled = node.closest<HTMLElement>('[title]');
  if (!titled) return null;
  if (!titled.getAttribute('title')?.trim()) return null;
  // Interactive between the tap and the title, or the titled element itself.
  if (node.closest(INTERACTIVE_SELECTOR)) return null;
  if (node.closest('[data-no-tap-tooltip]')) return null;
  return titled;
}

interface OpenTip {
  text: string;
  anchor: HTMLElement;
  rect: DOMRect;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

export function TapTooltipLayer() {
  const [tip, setTip] = useState<OpenTip | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  // The listeners are registered once, so the open tip is read from a ref.
  const tipRef = useRef<OpenTip | null>(null);
  tipRef.current = tip;

  useEffect(() => {
    const close = () => setTip(null);
    // The pointer type of the press in progress; the release reads it.
    let pointerType = 'mouse';

    const onPointerDown = (event: PointerEvent) => {
      pointerType = event.pointerType || 'mouse';
      // A press anywhere else closes the bubble. A press on the same element
      // does not, so that its release can toggle the bubble shut.
      const open = tipRef.current;
      if (open && tapTooltipTarget(event.target) !== open.anchor) close();
    };

    // pointerup rather than click: iOS Safari does not reliably send a click
    // for a tap on an element nothing treats as clickable. A press that turns
    // into a scroll ends in pointercancel and never gets here.
    const onPointerUp = (event: PointerEvent) => {
      if (pointerType === 'mouse') return;
      const anchor = tapTooltipTarget(event.target);
      if (!anchor) return;
      if (tipRef.current?.anchor === anchor) {
        close();
        return;
      }
      setPlacement(null);
      setTip({
        text: (anchor.getAttribute('title') ?? '').trim(),
        anchor,
        rect: anchor.getBoundingClientRect(),
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('keydown', onKeyDown);
    // Capture: the scroll that matters is usually an inner container's.
    document.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('resize', close);
    // Views are hash routes; the anchor is gone after a switch.
    window.addEventListener('hashchange', close);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('hashchange', close);
    };
  }, []);

  // Measure, then place: the bubble renders hidden for one frame so its size is
  // known before it goes above the anchor, or below when there is no room.
  useLayoutEffect(() => {
    if (!tip) {
      setPlacement(null);
      return;
    }
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const box = bubble.getBoundingClientRect();
    const rightEdge = Math.max(VIEWPORT_MARGIN, window.innerWidth - box.width - VIEWPORT_MARGIN);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, tip.rect.left + tip.rect.width / 2 - box.width / 2),
      rightEdge
    );
    const above = tip.rect.top - box.height - ANCHOR_GAP;
    const bottomEdge = Math.max(VIEWPORT_MARGIN, window.innerHeight - box.height - VIEWPORT_MARGIN);
    const top =
      above >= VIEWPORT_MARGIN ? above : Math.min(tip.rect.bottom + ANCHOR_GAP, bottomEdge);
    setPlacement({ left, top });
  }, [tip]);

  // Tie the bubble to its element for assistive technology while it is open.
  useEffect(() => {
    if (!tip) return;
    const { anchor } = tip;
    anchor.setAttribute('aria-describedby', TOOLTIP_ID);
    return () => {
      if (anchor.getAttribute('aria-describedby') === TOOLTIP_ID) {
        anchor.removeAttribute('aria-describedby');
      }
    };
  }, [tip]);

  if (!tip) return null;

  return createPortal(
    // pointer-events-none: a tap on the bubble reaches what is under it and
    // closes the bubble, instead of being swallowed.
    <div className="pointer-events-none fixed inset-0 z-[200]">
      <div
        ref={bubbleRef}
        id={TOOLTIP_ID}
        role="tooltip"
        className="absolute max-w-[min(20rem,calc(100vw-1rem))] whitespace-pre-line wrap-break-word rounded-md border border-border bg-popover px-2 py-1 text-xs leading-snug text-popover-foreground shadow-md"
        style={{
          left: placement?.left ?? 0,
          top: placement?.top ?? 0,
          visibility: placement ? 'visible' : 'hidden',
        }}
      >
        {tip.text}
      </div>
    </div>,
    document.body
  );
}
