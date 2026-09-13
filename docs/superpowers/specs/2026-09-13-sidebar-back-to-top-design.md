# Sidebar back-to-top button

## Goal

When the channel/contact list in the sidebar grows long enough to scroll, give
the user a quick way to jump back to the top without manual scrolling.

## Scope

- Applies to the expanded conversation list only: the `overflow-y-auto`
  container in `frontend/src/components/Sidebar.tsx` that holds the search box,
  customize panel, "mark all read" row, and all sections.
- Also active inside the mobile drawer mount (`forceExpanded`), because that
  mounts the same expanded list.
- Not applied to the icon rail (collapsed sidebar), which holds only the tool
  icons and does not overflow in practice.
- No backend changes. No new dependencies. No persisted state.

## Behavior

- A floating circular button ("back to top") overlays the bottom-right of the
  list area.
- Hidden while the list is at or near the top. Fades in once the list is
  scrolled down past a threshold of 300px.
- Clicking scrolls the list smoothly back to the top
  (`scrollTo({ top: 0, behavior: 'smooth' })`).
- Because it only appears after scrolling, a short (non-overflowing) list never
  shows it.

## Implementation

- Wrap the scrolling list `<div>` in a `relative` parent so the button can be
  positioned against the list viewport (the button must stay put while list
  content scrolls, so it is a sibling of the scroll element, not a child of it).
- Add a `ref` to the scroll element and an `onScroll` handler that sets a
  `showBackToTop` boolean from `scrollTop > 300`.
- Render the button conditionally (or always-mounted with an opacity/pointer
  transition) at `absolute bottom-4 right-4` on the wrapper.
- Icon: `ChevronUp` from `lucide-react` (already the icon library in this file).
- Styling reuses existing tokens: rounded-full, `h-8 w-8`, `bg-card` /
  `bg-secondary`, `border border-border`, `shadow`, `text-muted-foreground
  hover:text-foreground`, `transition-opacity`, and the standard
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`.

## Accessibility & i18n

- Button carries `aria-label` and `title` from a new translation key
  `nav_back_to_top`, added to EN, NL, and DE (enforced by the project's i18n
  lint + parity test).
- Keyboard focusable with a visible focus ring, consistent with other sidebar
  buttons.

## Testing

- Extend `frontend/src/test/sidebar.test.tsx`: render the sidebar with enough
  conversations to overflow, assert the button is absent initially, simulate a
  scroll past the threshold, assert the button appears, click it, and assert
  the scroll target was reset to top (mock/observe `scrollTo`).
- Run the frontend CI-equivalent gates before claiming done: `lint`,
  `format:check`, `test:run`, `build`.

## Out of scope

- Back-to-top for the icon rail.
- A "scroll to bottom" counterpart.
- Any persisted preference or settings toggle.
