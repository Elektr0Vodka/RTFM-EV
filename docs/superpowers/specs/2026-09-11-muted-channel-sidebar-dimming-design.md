# Muted channel sidebar dimming

Date: 2026-09-11
Branch: claude/mute-channel-option-4ad000

## Problem

The app already supports muting a followed channel (including Public). Muting
suppresses browser notifications, web push, unread counts, and the mention
ticker, shows a BellOff icon on the sidebar row, and sorts the channel to the
bottom of the list. This was merged from upstream (commit c8c8e6b, "Add channel
mute").

What is missing from the original request is a visual cue on the sidebar bar
itself: the muted channel's row still renders its name at full normal contrast,
so the row does not read as "quieted" at a glance.

## Goal

When a channel is muted, visually recede its sidebar bar while keeping the
"muted" marker legible. Chosen treatment (option C from visual review):

- The channel name fades to reduced opacity and renders in italic.
- The BellOff icon stays at its existing `text-muted-foreground` contrast, so
  the muted cue is never lost.

This is a purely visual change. No behavior changes.

## Scope

In scope:
- Dim the muted channel row's name in the sidebar (opacity + italic).

Explicitly out of scope (already implemented, left untouched):
- The mute toggle control (ChatHeader notification dropdown checkbox).
- Notification / unread / push suppression logic.
- The BellOff icon rendering.
- Muted-to-bottom sort order and Public-pinned-to-top behavior.
- Types, API, backend, i18n. No new strings are needed; the BellOff
  `aria-label` (`a11y_channel_muted`) already exists.

## Design

Single component change: `frontend/src/components/Sidebar.tsx`,
`renderConversationRow`.

- The name span (currently around line 695):
  `<span className="name flex-1 truncate text-[0.8125rem]">{row.name}</span>`
  When `row.muted` is true, add `opacity-40 italic` to that span's class list
  (via the existing `cn(...)` helper used elsewhere in the file).
- Leave the BellOff icon block (around line 706) unchanged.

Notes:
- `row.muted` is only set in `buildChannelRow`; contact rows never set it, so
  contacts are unaffected. Public and every followed channel are treated
  identically.
- Active muted channel: when a muted channel is the open conversation, its row
  is both active (accent background) and dimmed. The row stays dimmed even when
  active, for consistency. An open muted channel still reads as muted.

## Verification

1. Sidebar test: assert the name span carries `opacity-40 italic` when the
   channel is muted, and does not when it is unmuted.
2. Run frontend lint and the test suite; confirm i18n parity test still passes
   (no new strings, so it should be unaffected).
3. Observe live in the running app (local Docker on :8000): mute Public and a
   regular channel, confirm the bar name dims and italicizes while the bell icon
   stays crisp, and confirm an unmuted channel is unchanged.

## Risks

- Low. Styling-only, one component, guarded by an existing boolean.
- If `opacity-40` proves too faint against the dark theme in practice, adjust
  the opacity step during live verification. This is a tuning value, not a
  structural risk.
