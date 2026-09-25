# Frontend AGENTS.md

This document is the frontend working guide for agents and developers.
Keep it aligned with `frontend/src` source code.

## Stack

- React 18 + TypeScript
- Vite
- Vitest + Testing Library
- shadcn/ui primitives
- Tailwind utility classes + local CSS (`index.css`, `styles.css`)
- Sonner (toasts)
- Leaflet / react-leaflet (map)
- `@michaelhart/meshcore-decoder` installed via npm alias to `meshcore-decoder-multibyte-patch`
- `meshcore-hashtag-cracker` + `nosleep.js` (channel cracker)
- Multibyte-aware decoder build published as `meshcore-decoder-multibyte-patch`

## Code Ethos

- Prefer fewer, stronger modules over many thin wrappers.
- Split code only when the new hook/component owns a real invariant or workflow.
- Keep one reasoning unit readable in one place, even if that file is moderately large.
- Avoid dedicated files whose main job is pass-through, prop bundling, or renaming.
- For this repo, "locally dense but semantically obvious" is better than indirection-heavy "clean architecture".
- When refactoring, preserve behavior first and add tests around the seam being moved.

## Frontend Map

```text
frontend/src/
├── main.tsx                # React entry point (StrictMode, root render)
├── App.tsx                 # Data/orchestration entry that wires hooks into AppShell
├── api.ts                  # Typed REST client
├── types.ts                # Shared TS contracts
├── useWebSocket.ts         # WS lifecycle + event dispatch
├── wsEvents.ts             # Typed WS event parsing / discriminated union
├── prefetch.ts             # Consumes prefetched API promises started in index.html
├── index.css               # Global styles/utilities
├── styles.css              # Additional global app styles
├── themes.css              # Color theme definitions
├── contexts/
│   ├── DistanceUnitContext.tsx # Browser-local distance-unit context/provider
│   ├── PathHopWidthContext.tsx # Browser-local path hop-width display preference
│   ├── RichPayloadContext.tsx  # Browser-local rich MeshCore payload rendering preference
│   └── PushSubscriptionContext.tsx # Push subscription state context/provider
├── lib/
│   └── utils.ts            # cn() - clsx + tailwind-merge helper
├── networkGraph/
│   └── packetNetworkGraph.ts # Packet→network graph construction shared by visualizer surfaces
├── stores/
│   └── rawPacketStore.ts   # Overheard packet stream + session stats, outside React
├── hooks/
│   ├── index.ts            # Central re-export of all hooks
│   ├── useConversationActions.ts   # Send/resend/trace/block conversation actions
│   ├── useConversationNavigation.ts # Search target, selection reset, and info-pane navigation state
│   ├── useConversationMessages.ts  # Conversation timeline loading, cache restore, jump-target loading, pagination, dedup, pending ACK buffering
│   ├── useUnreadCounts.ts          # Unread counters, mentions, recent-sort timestamps
│   ├── useRealtimeAppState.ts      # WebSocket event application and reconnect recovery
│   ├── useAppShell.ts              # App-shell view state (settings/sidebar/modals/cracker)
│   ├── useRepeaterDashboard.ts      # Repeater dashboard state (login, panes, console, retries)
│   ├── useRadioControl.ts          # Radio health/config state, reconnection, mesh discovery sweeps
│   ├── useAppSettings.ts           # Settings, favorites, preferences migration
│   ├── useConversationRouter.ts    # URL hash → active conversation routing
│   ├── useContactsAndChannels.ts   # Contact/channel loading, creation, deletion
│   ├── useBrowserNotifications.ts  # Per-conversation browser notification preferences + dispatch
│   ├── useNewNodeNotifications.ts  # New-node browser notification preference (master + per-type) + WS event dispatch
│   ├── usePushSubscription.ts      # Web Push subscription lifecycle, per-conversation filters
│   ├── useFaviconBadge.ts          # Browser tab title + favicon (unread badge, brand name/icon)
│   ├── useEntranceSettled.ts       # Defers entrance animation work until layout settles
│   └── useRememberedServerPassword.ts # Browser-local repeater/room password persistence
├── components/
│   ├── AppShell.tsx            # App-shell layout: status, sidebar, search/settings panes, cracker, modals, security warning
│   ├── ConversationPane.tsx    # Active conversation surface selection (map/raw/trace/repeater/room/chat/contact-info/empty)
│   ├── visualizer/
│   │   ├── useVisualizerData3D.ts   # Packet→graph data pipeline, repeat aggregation, simulation state
│   │   ├── useVisualizer3DScene.ts  # Three.js scene lifecycle, buffers, hover/pin interaction
│   │   ├── VisualizerControls.tsx   # Visualizer legends and control panel overlay
│   │   ├── VisualizerTooltip.tsx    # Hover/pin node detail overlay
│   │   └── shared.ts                # Graph node/link types and shared rendering helpers
│   └── ...
├── utils/
│   ├── urlHash.ts              # Hash parsing and encoding
│   ├── conversationState.ts    # State keys, in-memory + localStorage helpers
│   ├── messageParser.ts        # Sender/hashtag/mention parsing helpers used by the tokenizer
│   ├── chatEntities.ts         # tokenizeMessageText: text → ordered mention/url/hashtag/pubkey/coordinate tokens (pubkey/coord/url gated by app_settings.chat_*); coordinates include MGRS (mgrsText.ts)
│   ├── mgrsText.ts             # findMgrsReferences: upper-case MGRS in text → lat/lon (mgrs npm); mirrors app/location_payloads.py
│   ├── coordinateFormat.ts     # Coordinate display format (decimal/dms/mgrs, localStorage + useCoordinateFormat) + formatCoordinates
│   ├── pathUtils.ts            # Distance/validation helpers for paths + map
│   ├── traceMapUtils.ts        # Pure helpers: trace-result node locations + solid/dashed map segments (TraceRouteMap)
│   ├── pubkey.ts               # getContactDisplayName (12-char prefix fallback)
│   ├── contactAvatar.ts        # Avatar color derivation from public key
│   ├── rawPacketIdentity.ts    # observation_id vs id dedup helpers
│   ├── rawPacketStats.ts       # Session packet stats windows, rankings, and coverage helpers
│   ├── regionScope.ts          # Regional flood-scope label/normalization helpers
│   ├── meshcoreOpenPayloads.ts # Rich MeshCore Open payload detection/rendering helpers
│   ├── textReplace.ts          # Shared message text substitution helpers
│   ├── pathHopWidthPreference.ts # LocalStorage persistence for hop-width display toggle
│   ├── richPayloadPreference.ts  # LocalStorage persistence for rich payload rendering toggle
│   ├── visualizerUtils.ts      # 3D visualizer node types, colors, particles
│   ├── visualizerSettings.ts   # LocalStorage persistence for visualizer options
│   ├── a11y.ts                 # Keyboard accessibility helper
│   ├── distanceUnits.ts        # Browser-local distance unit persistence/helpers
│   ├── lastViewedConversation.ts   # localStorage for last-viewed conversation
│   ├── contactMerge.ts            # Merge WS contact updates into list
│   ├── localLabel.ts              # Local label (text + color) in localStorage
│   ├── sidebarLayout.ts           # Sidebar order reconcilers (section/tool/favorites-group orders + per-favorite-group sort orders + hidden-entry overlay persist server-side in app_settings, reversing migration _051; rail-collapse and per-group collapse stay localStorage) + one-time legacy-order migration helpers + contact-group pure helpers (create/rename/delete/toggle membership, `group:<id>` section keys)
│   ├── radioPresets.ts            # LoRa radio preset configurations
│   ├── publicChannel.ts           # Public-channel resolution helpers for routing/hash defaults
│   ├── fontScale.ts               # Browser-local relative font scale persistence/application
│   ├── theme.ts                   # Theme switching helpers
│   ├── autoFocusInput.ts          # Auto-focus input helper
│   ├── batteryDisplay.ts          # Battery level display helpers
│   ├── messageIdentity.ts         # Message identity/dedup helpers
│   ├── rawPacketInspector.ts      # Raw packet inspection helpers
│   ├── serverLoginState.ts        # Server login state helpers
│   └── statusDotPulse.ts          # Status dot pulse animation helpers
├── components/
│   ├── StatusBar.tsx
│   ├── Sidebar.tsx             # Conversation list; Customize panel (section/tool/favorites-group reorder+hide) + Contact Groups (create/rename/delete); each contact_group renders as its own reorderable/hideable/collapsible section (see sidebarLayout.ts); `owned` section (plan 17 phase 3): contacts whose `owner_key` equals the radio's public key (`ownPublicKey` prop, from App `config`), bucketed by type, rendered only when non-empty
│   ├── ChatHeader.tsx          # Conversation header (trace, favorite, delete)
│   ├── MessageList.tsx        # Message rows; #hashtag refs styled by state (followed/known/unknown) with an inline "+" to capture unknowns into the registry (auto-capture via app_settings.auto_add_mentioned_channels); hover React/Reply/Mark-unread/Delete (MessageRowActions) and reaction-target links (ReactionTargetLink); inline `<pubkey:type:Name>` contact shares (utils/chatEntities `findContactShares`, always tokenized, priority over the bare-pubkey scanner) render as ContactShareToken: known contact opens info, unknown shows name/type/short key + "Add contact" via `onAddSharedContact` (App: `handleCreateContact(name, key, false, type)`); rows with txt_type === TXT_TYPE_GROUP_DATA (GRP_DATA channel datagrams, marker text `[image] id=.. chunks=..` / `[data] type=.. len=..`) render an "Image (not supported)" / "Data (not supported)" placeholder instead of the text
│   ├── MessageInput.tsx
│   ├── NewMessageModal.tsx     # Contact / Contact link (meshcore:// import) / channel tabs
│   ├── ContactLinkShare.tsx    # On-demand meshcore:// link with copy (contact info + Settings > Radio)
│   ├── ChannelImportExportModal.tsx # Channel text-file export/import + Communities tab
│   ├── CommunitiesPanel.tsx    # meshcore-open communities: join (paste JSON / camera / QR image), add hashtag, export JSON/QR
│   ├── SearchView.tsx          # Full-text message search pane
│   ├── SettingsModal.tsx       # Layout shell - delegates to settings/ sections
│   ├── SecurityWarningModal.tsx # Startup warning for trusted-network / bot execution posture
│   ├── RawPacketList.tsx
│   ├── RawPacketFeedView.tsx   # Live raw packet feed (list + filters + inspector); stats moved to Mesh Trends
│   ├── RawPacketDetailModal.tsx # On-demand packet inspector dialog + RawPacketPasteInspector (shared paste-hex body)
│   ├── MeshTrendsView.tsx      # Tools view: Live / Historical tabs (consolidated stats)
│   ├── PacketFeedStatsPanel.tsx # Live tab: session packet-stat breakdowns (reads rawPacketStore)
│   ├── MeshTrendsHistoricalPanel.tsx # Historical tab: server-backed stats (GET /api/statistics)
│   ├── AnalyzePacketView.tsx   # Tools view: standalone paste-a-hex packet inspector
│   ├── MeshDiscoveryView.tsx   # Tools view: mesh discovery sweep (repeaters/sensors) + last-sweep results + repeater region discovery
│   ├── MapView.tsx
│   ├── TracePane.tsx           # Multi-hop route trace builder/results view
│   ├── VisualizerView.tsx
│   ├── PacketVisualizer3D.tsx
│   ├── PathModal.tsx
│   ├── PathRouteMap.tsx
│   ├── TraceRouteMap.tsx        # Draws a TracePane result on a map (hops at known/manual locations, dashed gap over skipped hops, SNR tooltip); shares marker/colour helpers with PathRouteMap via map/routeMapVisuals.ts
│   ├── CrackerPanel.tsx       # Browser channel finder; wordlist = bundled ENGLISH_WORDLIST + remote sync + registry names ("Sync from channels" button, meshcore-wordlist-registry-cache)
│   ├── BotCodeEditor.tsx
│   ├── ContactAvatar.tsx
│   ├── ContactInfoPane.tsx     # Contact detail sheet (mobile; wraps ContactInfoBody)
│   ├── ContactInfoBody.tsx     # Shared contact-info section stack (region-aware: Sheet + full page)
│   ├── ContactInfoView.tsx     # Desktop full-page contact info (3 columns + minimizable repeater/room login)
│   ├── ContactStatusInfo.tsx   # Contact status info component
│   ├── ContactPathDiscoveryModal.tsx # Forward/return path discovery dialog
│   ├── ContactRoutingOverrideModal.tsx # Manual direct-route override editor
│   ├── RepeaterDashboard.tsx   # Layout shell - delegates to repeater/ panes
│   ├── RepeaterLogin.tsx       # Repeater login form (password + guest)
│   ├── RoomServerPanel.tsx     # Room-server auth gate + status banner ahead of room chat
│   ├── ServerLoginStatusBanner.tsx # Shared repeater/room login state banner
│   ├── ChannelInfoPane.tsx     # Channel detail sheet (stats, top senders)
│   ├── ChannelFloodScopeOverrideModal.tsx # Per-channel flood-scope override editor
│   ├── ChannelPathHashModeOverrideModal.tsx # Per-channel path hash mode override editor
│   ├── BulkAddChannelResultModal.tsx # Results dialog for bulk channel creation
│   ├── CommandPalette.tsx      # Command palette overlay
│   ├── DirectTraceIcon.tsx     # Shared direct-trace glyph used in header/dashboard
│   ├── NeighborsMiniMap.tsx    # Leaflet mini-map for repeater neighbor locations
│   ├── settings/
│   │   ├── settingsConstants.ts          # Settings section type, ordering, labels
│   │   ├── SettingsRadioSection.tsx      # Name, keys, advert interval, max contacts, radio preset, freq/bw/sf/cr, txPower, lat/lon, reboot, known regions
│   │   ├── SettingsLocalSection.tsx      # Browser-local settings: theme, relative font scale, local label, reopen last conversation
│   │   ├── SettingsFanoutSection.tsx     # Fanout integrations: MQTT, bots, config CRUD
│   │   ├── SettingsRadioAppSection.tsx    # Radio-App Management: tracked telemetry, contact management, blocked lists, partial-node sync
│   │   ├── PartialNodeSyncModal.tsx       # Review + apply soft resolutions of partial nodes vs the external-map cache
│   │   ├── SettingsDatabaseSection.tsx   # Database: DB size, storage cleanup, auto-decrypt
│   │   ├── SettingsAboutSection.tsx     # Version, author, license, links
│   │   ├── ThemeSelector.tsx           # Color theme picker
│   │   └── BulkDeleteContactsModal.tsx # Bulk contact deletion dialog
│   ├── repeater/
│   │   ├── repeaterPaneShared.tsx        # Shared: RepeaterPane, KvRow, format helpers
│   │   ├── RepeaterTelemetryPane.tsx    # Battery, airtime, packet counts
│   │   ├── RepeaterNeighborsPane.tsx    # Neighbor table + lazy mini-map
│   │   ├── RepeaterAclPane.tsx          # Permission table
│   │   ├── RepeaterNodeInfoPane.tsx      # Repeater name, coords, clock drift
│   │   ├── RepeaterRadioSettingsPane.tsx # Radio config + advert intervals
│   │   ├── RepeaterRegionsPane.tsx      # Region hierarchy / flood-allowed region names
│   │   ├── RepeaterLppTelemetryPane.tsx # CayenneLPP sensor data
│   │   ├── RepeaterOwnerInfoPane.tsx    # Owner info + guest password
│   │   ├── RepeaterTelemetryHistoryPane.tsx # Historical telemetry chart/table
│   │   ├── RepeaterActionsPane.tsx      # Send Advert, Sync Clock, Reboot
│   │   └── RepeaterConsolePane.tsx      # CLI console with history
│   └── ui/                     # shadcn/ui primitives
├── types/
│   └── d3-force-3d.d.ts       # Type declarations for d3-force-3d
└── test/                      # Representative frontend test suites (not an exhaustive listing)
    ├── setup.ts
    ├── fixtures/websocket_events.json
    ├── api.test.ts
    ├── appFavorites.test.tsx
    ├── appStartupHash.test.tsx
    ├── conversationPane.test.tsx
    ├── contactAvatar.test.ts
    ├── contactInfoPane.test.tsx
    ├── integration.test.ts
    ├── mapView.test.tsx
    ├── messageCache.test.ts
    ├── messageList.test.tsx
    ├── messageParser.test.ts
    ├── rawPacketList.test.tsx
    ├── pathUtils.test.ts
    ├── prefetch.test.ts
    ├── rawPacketDetailModal.test.tsx
    ├── rawPacketFeedView.test.tsx
    ├── rawPacketIdentity.test.ts
    ├── repeaterDashboard.test.tsx
    ├── repeaterFormatters.test.ts
    ├── repeaterLogin.test.tsx
    ├── repeaterMessageParsing.test.ts
    ├── roomServerPanel.test.tsx
    ├── securityWarningModal.test.tsx
    ├── localLabel.test.ts
    ├── messageInput.test.tsx
    ├── newMessageModal.test.tsx
    ├── settingsModal.test.tsx
    ├── sidebar.test.tsx
    ├── statusBar.test.tsx
    ├── tracePane.test.tsx
    ├── traceMapUtils.test.ts
    ├── unreadCounts.test.ts
    ├── urlHash.test.ts
    ├── appSearchJump.test.tsx
    ├── channelInfoKeyVisibility.test.tsx
    ├── chatHeaderKeyVisibility.test.tsx
    ├── searchView.test.tsx
    ├── useConversationActions.test.ts
    ├── useConversationMessages.test.ts
    ├── useConversationMessages.race.test.ts
    ├── useConversationNavigation.test.ts
    ├── useAppShell.test.ts
    ├── useBrowserNotifications.test.ts
    ├── useFaviconBadge.test.ts
    ├── useRepeaterDashboard.test.ts
    ├── useRememberedServerPassword.test.ts
    ├── useContactsAndChannels.test.ts
    ├── useRealtimeAppState.test.ts
    ├── useUnreadCounts.test.ts
    ├── useWebSocket.dispatch.test.ts
    ├── useWebSocket.lifecycle.test.ts
    ├── rawPacketStats.test.ts
    ├── fontScale.test.ts
    └── wsEvents.test.ts

```

## Architecture Notes

### State ownership

`App.tsx` is now a thin composition entrypoint over the hook layer. `AppShell.tsx` owns shell layout/composition:
- local label banner
- status bar
- desktop/mobile sidebar container
- search/settings surface switching
- global cracker mount/focus behavior
- new-message modal and info panes
- trusted-network `SecurityWarningModal`

High-level state is delegated to hooks:
- `useAppShell`: app-shell view state (settings section, sidebar, cracker, new-message modal)
- `useRadioControl`: radio health/config state, reconnect/reboot polling
- `useAppSettings`: settings CRUD, favorites, preferences migration
- `useContactsAndChannels`: contact/channel lists, creation, deletion
- `useConversationRouter`: URL hash → active conversation routing
- `useConversationNavigation`: search target, conversation selection reset, and info-pane state
- `useConversationActions`: send/resend/trace/path-discovery/block handlers and channel override updates
- `useConversationMessages`: conversation switch loading, embedded conversation-scoped cache, jump-target loading, pagination, dedup/update helpers, reconnect reconciliation, and pending ACK buffering
- `useUnreadCounts`: unread counters, mention tracking, recent-sort timestamps, server `last_read_ats`, `first_unread_ids` (the unread-divider anchor), and `markConversationUnreadFromMessage` ("mark unread from here")
- `useRealtimeAppState`: typed WS event application, reconnect recovery, cache/unread coordination
- `useRepeaterDashboard`: repeater dashboard state (login, pane data/retries, console, actions)

`App.tsx` intentionally still does the final `AppShell` prop assembly. That composition layer is considered acceptable here because it keeps the shell contract visible in one place and avoids a prop-bundling hook with little original logic.

**The overheard packet stream is the one piece of app state that deliberately does not live in React.** It is held in `stores/rawPacketStore.ts` and read through `useSyncExternalStore`, because it updates several times a second with every packet the node hears - far more often than anything else - and only a few surfaces consume it (`MapView`, `VisualizerView`, `RawPacketFeedView`, `CrackerPanel`, and `PacketFeedStatsPanel` on the Mesh Trends Live tab). Held in `App` state it re-rendered the entire tree, including `MessageList`, which is neither memoized nor cheap on a long history.

That gives the store a load-bearing invariant: **no ancestor of `MessageList` may call `useRawPackets()` / `useRawPacketStatsSession()`.** Nothing about the prop signatures enforces it - an innocuous-looking subscription added to `App`, `AppShell`, or `ConversationPane` silently restores the original slowdown. `src/test/appPacketIsolation.test.tsx` pins it by mounting the real ancestor chain and asserting `MessageList` does not re-render when packets arrive; it carries a negative control so the assertion cannot pass vacuously. Reach for packets in a new view by subscribing in that view, never by lifting them up.

`ConversationPane.tsx` owns the main active-conversation surface branching:
- empty state
- map view
- visualizer
- raw packet feed
- trace view
- repeater dashboard
- room-server auth/status gate before room chat
- normal chat chrome (`ChatHeader` + `MessageList` + `MessageInput`)

### Initial load + realtime

- Initial data: REST fetches (`api.ts`) for config/settings/channels/contacts/unreads.
- WebSocket: realtime deltas/events.
- On reconnect, the app refetches channels and contacts, refreshes unread counts, and reconciles the active conversation to recover disconnect-window drift.
- On WS connect, backend sends `health` only; contacts/channels still come from REST.

### New Message modal

`NewMessageModal` resets form state on close. The component instance persists across open/close cycles for smooth animations.

The "Contact link" tab only renders when `onImportContactUri` is passed (App wires `handleImportContactUri` from `useContactsAndChannels`). It checks the `meshcore://` prefix locally, then `api.importContactUri` (`POST /contacts/import-uri`) does the real validation (hex, ADVERT, signature) and the radio import; the backend error is shown inline and the dialog stays open. On success the contact list is refetched and the imported contact's conversation opens. The historical-decrypt checkbox is hidden on this tab.

### Message behavior

- Outgoing sends are added to UI after the send API returns (not pre-send optimistic insertion), then persisted server-side.
- Backend also emits WS `message` for outgoing sends so other clients stay in sync.
- ACK/repeat updates arrive as `message_acked` events.
- Outgoing channel messages show a 30-second resend control; resend calls `POST /api/messages/channel/{message_id}/resend`.
- Failed DMs: an outgoing DM with `failed_at` set and `acked === 0` shows a red "Failed" marker instead of the pending `?` (`acked > 0` always wins, so a late ACK shows as delivered). WS `message_failed` sets `failed_at` via `useConversationMessages.receiveMessageFailed`. `MessageRowActions` gets an `onRetry` (Retry button) only for such rows; `useConversationActions.handleRetryDirectMessage` calls `POST /api/messages/direct/{message_id}/resend`, removes the failed row (`removeMessage`) and adds the new copy. Other clients drop the failed row on WS `message_deleted`. Retry transmits over RF.
- Conversation-scoped message caching now lives inside `useConversationMessages.ts` rather than a standalone `messageCache.ts` module. If you touch message timeline restore/dedup/reconnect behavior, start there.
- `contact_resolved` is a real-time identity migration event, not just a contact-list update. Changes in that area need to consider active conversation state, cached messages, unread state keys, and reconnect reconciliation together.
- Deleting a message (`MessageRowActions` "Delete", after a `window.confirm`) calls `DELETE /api/messages/{id}` then removes it locally via `useConversationMessages`' `removeMessage` (active list + `conversationMessageCache`, any conversation). The backend's `message_deleted` WS event drives the same removal in every other open tab and re-fetches unread counts (`refreshUnreads`) rather than reproducing the count/first-unread-boundary math client-side. Local only; nothing is sent over RF.

### Visualizer behavior

- `VisualizerView.tsx` hosts `PacketVisualizer3D.tsx` (desktop split-pane and mobile tabs).
- `PacketVisualizer3D.tsx` is now a thin composition shell over visualizer-specific hooks/components in `components/visualizer/`.
- `PacketVisualizer3D` uses persistent Three.js geometries for links/highlights/particles and updates typed-array buffers in-place per frame.
- Packet repeat aggregation keys prefer decoder `messageHash` (path-insensitive), with hash fallback for malformed packets.
- Raw-packet decoding in `RawPacketList.tsx` and `visualizerUtils.ts` relies on the multibyte-aware decoder fork; keep frontend packet parsing aligned with backend `path_utils.py`.
- Raw packet events carry both:
  - `id`: backend storage row identity (payload-level dedup)
  - `observation_id`: realtime per-arrival identity (session fidelity)
- Packet feed/visualizer render keys and dedup logic should use `observation_id` (fallback to `id` only for older payloads).
- The frontend-only packet stats live on the Mesh Trends "Live" tab (`PacketFeedStatsPanel`), not the raw packet feed. They track a separate lightweight per-observation session history (`rawPacketStore`) for charts/rankings, so windows are not limited by the visible packet list cap. Coverage messaging should stay honest when detailed in-memory stats history has been trimmed or the selected window predates the current browser session.

### Live packet map (`map/packets/`)

- The map's "Visualize packets" feature renders with a single deck.gl overlay (`map/layers/packetDeckOverlay.ts`: one `MapLibreOverlay`, arcs + pulses + glow) in both flat 2D and tilted 3D. It replaces the former 2D canvas `particleOverlay` and the 3D-only `tracesDeck` arc path.
- deck.gl's `MapLibreOverlay` allows only ONE interleaved overlay per map (a second throws). Every deck-drawn map feature therefore shares one overlay through `map/layers/sharedDeckOverlay.ts` (`acquireDeckSlot(map, key, deck, build)`): packets and neon nodes are slots, drawn in `SLOT_ORDER` (neon under packets). Do not construct another `MapLibreOverlay` on the main map; add a slot key instead. Slot builders must return fresh layer instances (the overlay rebuilds them after a WebGL context restore).
- deck.gl 9 layer `parameters` use WebGPU-style names (`depthCompare`, `depthWriteEnabled`); the legacy `depthTest`/`depthMask` keys are silently ignored.
- With 3D buildings on, `map/engine/buildingHeights.ts` lifts neon nodes, packet arc ends, pulses and glows to the roof height of the building under a node (read from the rendered `buildings-3d` layer; 0 when buildings are off or below its minzoom). The flat GL node circles cannot be elevated; they stay at ground level but draw above the buildings (`setBuildings3D` anchors the extrusion below the lowest node overlay layer).
- `map/packets/` holds the framework-agnostic engine: `playbackController.ts` (a virtual clock - live follows wall time minus a smoothing buffer, replay is seekable at a rate), `packetTimeline.ts` (time-indexed buffer whose `stateAsOf(ms)` derives the render model), `packetAnimMath.ts` (pure freshness/pulse/glow/SNR math), and `clickAudio.ts` (optional geiger click). All are unit-tested without a map.
- **`packetNetworkGraph` is the single path authority** for the live map: the timeline resolves every packet's route through `buildCanonicalPathForPacket`/`ingestPacketIntoPacketNetwork`, then maps node ids to coordinates via the contact-index resolver (`resolveLinkCoord`). There is no second ad-hoc path resolver. As a solo observer, the segment touching our `self` node is drawn witnessed (solid); inferred upstream hops are faint; an unresolved hop is bridged, never placed at `[0,0]`.
- The `PlaybackBar` (`map/controls/PlaybackBar.tsx`) is a VCR (play/pause/speed/seek/Live/look-back); deeper look-back backfills via `GET /packets/recent?before_ts=`. The render loop mirrors the clock snapshot to React throttled (~150ms) so the 60fps clock does not re-render the tree.

### Virtualization (`MessageList`)

The message list is windowed with `@tanstack/react-virtual`; only the visible rows are mounted, so render cost no longer scales with conversation length. Three details are load-bearing and easy to break:

- **`scrollMargin`** is measured from the virtual spacer's offset within the scroll container, because the container carries `p-4` and can show an "older messages" banner above the rows. Without it every `scrollToIndex` with `start`/`center` lands 16–48px high, and the error shifts as the banner appears during pagination. Rows must subtract it back out in their `translateY`.
- **The bottom-pin is deferred and re-asserted** across a bounded run of frames rather than performed once, because row heights start as estimates and a single `scrollToIndex` gets undone as they converge (completely so under StrictMode's double-invoked effects). It is cancelled by a pending `targetMessageId` and by any deliberate scroll gesture.
- **`getItemKey` returns a string sentinel** for indices past the end of a shrunken list; a bare index would collide with the numeric message-id keyspace and poison the measurement cache.

jsdom has no layout engine, so none of this is observable from the vitest suite - it needs a real browser.

### Radio settings behavior

- `SettingsRadioSection.tsx` surfaces `path_hash_mode` only when `config.path_hash_mode_supported` is true.
- `SettingsRadioSection.tsx` also exposes `multi_acks_enabled` as a checkbox for the radio's extra direct-ACK transmission behavior.
- Advert-location control is intentionally only `off` vs `include node location`. Companion-radio firmware does not reliably distinguish saved coordinates from live GPS in this path.
- The advert action is mode-aware: the radio settings section exposes both flood and zero-hop manual advert buttons, both routed through the same `onAdvertise(mode)` seam.
- Mesh discovery (the Tools > Mesh Discovery view, `#mesh-discovery`) is limited to node classes that currently answer discovery control-data requests in firmware: repeaters and sensors. Sweep state lives in `useRadioControl`, so the last result survives navigation. The same view hosts repeater region discovery (formerly in Settings > Radio), which prefers repeaters from the last sweep and saves added regions straight to `known_regions`.
- Frontend `path_len` fields are hop counts, not raw byte lengths; multibyte path rendering must use the accompanying metadata before splitting hop identifiers.

### Host repeater section (`components/settings/hostRepeater/`)

- Own settings section `host-repeater` (after `radio`), rendered from `SettingsModal`, which passes `floodScopeRegions` (`floodScopeRegions.ts`: app `flood_scope` + channel overrides, `#` stripped) and repeater contacts.
- `HostRepeaterRegions` edits the region map (`regionTree.ts` for tree order, parent choices and mapping a repeater region dump). An empty saved list is pre-filled in the draft only. The import calls `api.repeaterRegions`, which transmits, so it sits behind `window.confirm`; tests must mock it.

- `HostRepeaterSettings` edits one versioned settings document (`useHostRepeater`): validate via `POST .../validate`, then `PUT .../settings` with the loaded `version`; a 409 reloads. A WS `host_repeater` event reloads when there are no local edits, otherwise it shows a reload notice. On OpenHop radios it renders a disabled checkbox and a note only (no requests).
- Policy rules reuse `OpenHopPolicyEngineCard` / `OpenHopPolicyRules`; the condition builder takes an optional `vocabulary` (fields/operators) so the host's field list differs from the OpenHop API's. `HostRepeaterStatsPane` polls `GET .../stats` every 5 s while shadow mode is on. The host vocabulary adds `channel_name`, `region`, `path_first`, `path_last`, `path_string`, the `matches` operator and `ruleGates: true`, which makes `OpenHopRuleForm` show the match-probability / throttle / throttle-budget inputs (stored as `then.prob`, `then.throttle_seconds`, `then.throttle_key`; blank inputs are omitted from `then`). The OpenHop API section passes no `ruleGates`, so its form is unchanged. `OpenHopPolicyRules` takes optional `ruleStats` (`policy_matches`, `policy_passes`, `saved_airtime_by_rule` from the stats poll) and renders hits / passes / saved airtime plus `prob` / `throttle` badges per rule; a `payload_type` condition gets a name picker instead of the free-text value.
- Phase 4: Timing also edits `rx_delay_base` and `use_score_for_tx`; an own **Advert limiter** block edits the per-node token bucket (`advert_*`). `HostRepeaterStatsPane` renders the receive-hold percentiles (`rx_delay`), the advert limiter counters and a **Lifetime totals** block; its `onReset(lifetime)` maps to `api.resetHostRepeaterStats(lifetime)` (`POST .../stats/reset?lifetime=true`). The stats fields are optional in `HostRepeaterStats` so older fixtures stay valid.

### Chart zoom/pan (`lib/chartZoom.ts`, `hooks/useChartZoom.ts`, `components/charts/`)

- Time-series charts support wheel-zoom-to-cursor, drag-pan, and double-click
  reset, ported from `DutchMeshCore-Observers` (`svgchart.js` `barViewClamp` +
  `bindTimeZoom`), generalized to an arbitrary `[min,max]` domain.
- `lib/chartZoom.ts` is the single source of truth for the interaction math
  (`clampWindow` / `zoomAtFraction` / `panByFraction`, pure + unit-tested). The
  "x" unit is unix seconds for time charts and a bucket index for index/bin
  charts; `minSpan` is 30 (seconds) or 2 (buckets).
- Two adapters bind it to our two chart systems, so both feel identical:
  - **Recharts:** `useChartZoom` hook + `ZoomableChart` wrapper. The chart binds
    the returned `domain` onto a numeric `<XAxis domain allowDataOverflow
    type="number">` and hides its tooltip while `isPanning`. `RepeaterTelemetry`-
    `HistoryPane` is the exception: it drives its existing `<Brush>` window
    instead (skips drags that start on `.recharts-brush`).
  - **Custom SVG (`MyNodeView`):** `SvgZoomFrame` owns the wheel/drag/dblclick;
    `ZoomableBinChart` wraps it with per-chart index-window state and hands the
    child the visible slice of `bins`/`samples`. Every My Node chart (including
    the line charts) is wrapped, and each zooms independently.
- Wheel is bound with a native non-passive listener so it can `preventDefault`
  (React `onWheel` is passive). New charts opting in should set
  `isAnimationActive={false}` so zoom/pan re-renders don't animate.

## WebSocket (`useWebSocket.ts`)

- Auto reconnect (3s) with cleanup guard on unmount.
- Heartbeat ping every 30s.
- Incoming JSON is parsed through `wsEvents.ts`, which validates the top-level envelope and known event type strings, then casts payloads at the handler boundary. It does not schema-validate per-event payload shapes.
- Event handlers: `health`, `message`, `contact`, `contact_resolved`, `channel`, `raw_packet`, `message_acked`, `message_deleted`, `contact_deleted`, `channel_deleted`, `error`, `success`, `pong` (ignored).
- Event handlers: `health`, `message`, `contact`, `contact_resolved`, `channel`, `raw_packet`, `message_acked`, `message_failed`, `message_deleted`, `contact_deleted`, `channel_deleted`, `error`, `success`, `pong` (ignored).
- Event handlers: `health`, `message`, `contact`, `contact_resolved`, `channel`, `raw_packet`, `message_acked`, `new_node`, `contact_deleted`, `channel_deleted`, `error`, `success`, `pong` (ignored).
- `host_repeater` is not routed through a handler prop: `useWebSocket` re-emits it as a window event (`utils/hostRepeaterEvents.ts`), which `hooks/useHostRepeater.ts` subscribes to while Settings > Host repeater is mounted.
- Armed mode (plan 29 Phase 3): `HostRepeaterSettings` shows the arm panel only while `env_enabled`; **Arm live repeating...** is disabled with the blocker list (or while `dirty`), opens an inline confirmation with an "I understand" checkbox, then calls `api.setHostRepeaterMode('armed', true)` (`useHostRepeater.setMode`; a 409 carries `blockers` in `ApiError.detail`). While armed a red banner with **Disarm (kill switch)** (`api.disarmHostRepeater`) replaces it; `disarm_reason` / `rearm_pending` are shown after an automatic disarm. `useHostRepeater` applies the live fields of a WS event over local edits so the armed state is never stale. `StatusBar` shows a **Repeating** badge from `hooks/useHostRepeaterArmed.ts` (initial GET + the WS event). `HostRepeaterStatsPane` renders `stats.tx` (sent, errors, queue, drops).
- For `raw_packet` events, use `observation_id` as event identity; `id` is a storage reference and may repeat.

## URL Hash Navigation (`utils/urlHash.ts`)

Supported routes:
- `#raw`
- `#map`
- `#map/focus/{pubkey_or_prefix}`
- `#visualizer`
- `#search`
- `#trace`
- `#settings/{section}`
- `#channel/{channelKey}`
- `#channel/{channelKey}/{label}`
- `#contact/{publicKey}`
- `#contact/{publicKey}/{label}`
- `#link/{pubkeyA}/{pubkeyB}` - link detail page (`LinkDetailView`); conversation type `link` with id `a~b`

Where `{section}` is one of `radio`, `local`, `radio-app`, `database`, `fanout`, `openhop`, `handy-info`, or `about`.

Legacy name-based channel/contact hashes are still accepted for compatibility.

## Conversation State Keys (`utils/conversationState.ts`)

`getStateKey(type, id)` produces:
- channels: `channel-{channelKey}`
- contacts: `contact-{publicKey}`

Use full contact public key here (not 12-char prefix).

`conversationState.ts` keeps an in-memory cache and localStorage helpers used for migration/compatibility.
Canonical persistence for unread and sort metadata is server-side (`app_settings` + read-state endpoints).

## Utilities

### `utils/pubkey.ts`

Current public export:
- `getContactDisplayName(name, pubkey)`

It falls back to a 12-char prefix when `name` is missing.

### `utils/pathUtils.ts`

Distance/validation helpers used by path + map UI.

### `utils/traceMapUtils.ts`

Pure helpers for `TraceRouteMap.tsx`: `resolveTraceNodeLocations` places each
trace node ('local' at the radio config's location, 'repeater' at its matching
contact's effective location via `getEffectiveLocation`, 'custom' hex hops
never located), `buildTraceMapSegments` turns the located nodes into line
segments and marks a segment `dashed` when it bridges one or more skipped
(unlocated) hops. No component or maplibre dependency, so these are unit
tested directly (`test/traceMapUtils.test.ts`).

### Time-range selection (`components/TimeRangeSelector.tsx`, `utils/timeRanges.ts`, `utils/timeRangePreference.ts`)

Shared, single-source-of-truth time selector used by My Node, Mesh Health, Map,
and the Raw Packet Feed. `utils/timeRanges.ts` defines the base ranges
(`20m 1h 3h 6h 12h 24h 48h 3d 7d 14d 30d`) + `resolveRange(id, {nowSec, custom…,
extras})`. `TimeRangeSelector` renders the base buttons plus per-page extras
(`extrasBefore`/`extrasAfter`/`extrasSpecial`) and the Custom From/To/Apply row;
it owns only the option list and selection, not live-vs-DB or auto-refresh (those
stay per page, keyed off the selected id). `utils/timeRangePreference.ts`
persists each page's selection to localStorage (`rtfm-mynode-window`,
`rtfm-meshhealth-window`, `rtfm-rawfeed-window`; Map uses `remoteterm-map-since`
[+ `-custom`]). The Raw Packet Feed's base windows are DB-backed via
`api.getRawFeedStats` (mapped into a snapshot by `buildSnapshotFromHistorical`);
its `1m/5m/10m`/`session` windows stay in-memory (`isRawFeedLiveWindow`).

## Types and Contracts (`types.ts`)

`AppSettings` currently includes:
- `max_radio_contacts`
- `auto_decrypt_dm_on_advert`
- `last_message_times`
- `advert_interval`
- `last_advert_time`
- `flood_scope`
- `known_regions`
- `blocked_keys`, `blocked_names`, `discovery_blocked_types`
- `tracked_telemetry_repeaters`, `tracked_telemetry_contacts`
- `auto_resend_channel`
- `telemetry_interval_hours`

Note: MQTT, bot, and community MQTT settings were migrated to the `fanout_configs` table (managed via `/api/fanout`). They are no longer part of `AppSettings`.

`HealthStatus` includes `fanout_statuses: Record<string, FanoutStatusEntry>` mapping config IDs to `{name, type, status}`. Also includes `bots_disabled: boolean`.

`FanoutConfig` represents a single fanout integration: `{id, type, name, enabled, config, scope, sort_order, created_at}`.

`RawPacket.decrypted_info` includes `channel_key` and `contact_key` for MQTT topic routing.

`UnreadCounts` includes `counts`, `mentions`, `last_message_times`, `last_read_ats`, and `first_unread_ids`.

The unread divider is anchored to `first_unread_ids` - the id of the oldest unread message per conversation - not to a timestamp. `MessageList` locates it with `findIndex(msg.id === unreadMarkerMessageId)`, which returns `-1` when that message is not in the loaded window; that is the signal to offer "Jump to unread" (routed through the `targetMessageId`/`getMessagesAround` path) rather than render a divider. Locating by timestamp instead would return index 0 whenever the boundary sits further back than the loaded window, silently placing the divider on the wrong message.

Counts are incremented live over WebSocket while `first_unread_ids` only arrives with a full `/read-state/unreads` fetch, so `useUnreadCounts.incrementUnread` seeds the boundary itself on the read→unread transition. A channel going unread while the app is open would otherwise have a count but no boundary, and no divider at all.

**Mark unread from here**: a message-row action (`MessageRowActions`, envelope icon, incoming messages only) calls `useUnreadCounts.markConversationUnreadFromMessage`, which hits `api.markContactUnread`/`api.markChannelUnread` (`POST .../mark-unread {message_id}`) and then resyncs via `refreshUnreads`. Decision: read state stays server-side and shared across browsers, consistent with mark-read. Because the app auto-re-marks the active conversation as read on every `/unreads` refresh (WS reconnect, mute toggle, `channelsLen`/`contactsLen` change - see `fetchUnreads`), marking the *currently open* conversation unread would otherwise be wiped out on the very next such refresh. `useUnreadCounts` suppresses that auto re-mark for the conversation just marked unread (`suppressAutoReadKeyRef`) until the user genuinely navigates away and back to it (`prevActiveKeyRef` distinguishes a real navigation from an incidental re-render with a new `activeConversation` object for the same conversation) - at that point it is treated as read again, like any other conversation. There is no sidebar-level "mark unread" (no context-menu pattern exists in `Sidebar.tsx` to hang it off); only the per-message row action exists.

## Contact Info Pane

`ContactInfoBody`'s Network region lists **Message routes (scored)** from `analytics.path_scores` (`ContactPathScore` in `types.ts`, from `GET /contacts/analytics`): hops via `parsePathHops`, `Flood` for `path_len` -1, `(direct)` for an empty path, then `contact_path_score_detail` (score as a percentage, delivered/attempts, last trip time) and the last-used time. Rows carry `data-testid="contact-path-score"`. Display only; the backend does the scoring (plan 28 item 1.15).

Clicking a contact's avatar in `ChatHeader` or `MessageList` opens a `ContactInfoPane` sheet (right drawer) showing comprehensive contact details fetched from `GET /api/contacts/analytics` using either `?public_key=...` or `?name=...`:

- Header: avatar, name, public key, type badge, on-radio badge
- Info grid: last seen, first heard, last contacted, distance, hops
- GPS location (clickable → map)
- On-demand LPP telemetry: "Request" button fetches `POST /contacts/{key}/telemetry`, displays sensor readings via `LppSensorRow`, optional GPS mini-map (Leaflet), and history chart (Recharts). Opt-in tracking toggle uses `POST /settings/tracked-telemetry-contacts/toggle`.
- Favorite toggle
- Name history ("Also Known As") - shown only when the contact has used multiple names
- Message stats: DM count, channel message count
- Most active rooms (clickable → navigate to channel)
- Route details from the canonical backend surface (`effective_route`, `effective_route_source`, `direct_route`, `route_override`)
- Advert observation rate
- Nearest repeaters (resolved from first-hop path prefixes)
- Recent advert paths (informational only; not part of DM route selection)
- User annotations (`ContactAnnotations` section): notes, owner info (free text), an owner pubkey pointer (validated against known contacts; the owner name links to open the DM conversation via `onOpenConversation`), an "Owned nodes" reverse list (contacts whose `owner_key` equals this contact, opened via `onOpenContactInfo`), manual fallback GPS, and a battery chemistry override (`lipo`/`lifepo4`/`lipo_hv`/`nmc`, or "Use global default" which clears it to `null`). All save via `api.updateContactAnnotations` (`POST /contacts/{key}/annotations`); the live `contact` WS update reseeds the fields.
- Contact link (`ContactLinkShare`, below telemetry sharing): "Show contact link" calls `api.getContactUri` (`GET /contacts/{key}/contact-uri`, read from the radio's stored advert) only when clicked, then shows the `meshcore://` link read-only with a copy button; the backend error (for example no stored advert) is shown inline. Settings > Radio > Identity uses the same component with `api.getOwnContactUri` (`GET /radio/contact-uri`). No QR code for contact links (QR is only used for communities, see below).
- Communities (`CommunitiesPanel`, Channels > Import / Export > Communities tab): join by pasted QR JSON, camera scan or an uploaded QR image; per community add hashtag channels and export. The export (`GET /communities/{id}/export`, contains the secret) is fetched only when "Show QR code and JSON" is clicked; it offers copy JSON, download JSON and download PNG. QR helpers in `utils/communityQr.ts`: `uqr` renders (SVG for display, canvas PNG for download); `zxing-wasm/reader` scans, imported lazily with its `.wasm` bundled through Vite `?url` (`prepareZXingModule` `locateFile`), so scanning never fetches zxing-wasm's default jsDelivr URL. Camera scanning needs a secure context (HTTPS or localhost).
- Telemetry sharing (`ContactTelemetryPermissionsControl`, under radio residency): Battery / Location / Environment toggles that save via `api.setContactTelemetryPermissions` (`POST /contacts/{key}/telemetry-permissions`). Shows `telemetry_perms` when set in the app, else the radio's `(flags >> 1) & 7`; optimistic, reverts on error, and toasts when the contact is not on the radio yet.

Map links have three modes (`MapLinkMode` in `map/controls/MapControls.tsx`): `liveness` (client-side from live packets), `advert` (`/packets/advert-links`) and `traffic` (`/packets/traffic-links`, the per-packet edge log). The two server modes share the `map/layers/advertLinksLayer.ts` controller (traffic uses id prefix `rt-traffic-links` and a green line) and a link-age window from `map/linkAge.ts`: it follows the node "Heard since" window unless the user turns that off in `LinkAgeControl` and picks an own preset or From/To (persisted keys `remoteterm-map-link-age-*`). Clicking a server link opens a popup (`map/linkPopup.ts`) whose "Details" calls `onOpenLink` (threaded `ConversationPane` -> `MapView`) to open `#link/<a>/<b>`. The layer click listeners are bound once in `handleReady`, so they call the latest popup handler through a ref.

Effective map location is resolved by `getEffectiveLocation` in `utils/pathUtils.ts` (advertised coords win when valid, else manual coords). `MapView` projects it onto contacts so a manual-only node is mappable; the node popup shows a notes snippet, owner link, and a "Details" button that opens `ContactInfoPane` (`onOpenContactInfo`, threaded `App` → `ConversationPane` → `MapView`). Link/path drawing uses the same effective location: `resolveNodeCoord` (also in `utils/pathUtils.ts`) resolves a graph node id to coordinates for the liveness-links layer and packet-path pulses, so a manual-only node is drawn into paths too (not just placed as a marker). Discovery mode's packet-reveal gate (`resolvePacketContacts`) uses `hasEffectiveLocation` for the same reason, so a manual-only node is revealed by packet playback.

The shared-locations overlay (`map/useSharedLocations.ts` + `map/layers/sharedLocationsLayer.ts`) fetches `GET /messages/locations` for the map window (`sinceCutoffSec`/`sinceUntilSec`) while its FAB toggle is on (`remoteterm-map-shared-locations`, plus `-all` for every share). `MapView` calls `attach(map)` in `handleReady` and `reattach()` in `handleBasemapReapply`; the pin popup's "Open in chat" uses `onNavigateToMessage` (threaded `App` → `ConversationPane` → `MapView`, same target shape as search). Position text in map popups, contact info, chat location cards and the location picker goes through `formatCoordinates(lat, lon, useCoordinateFormat())`; wire formats (`buildMarkerPayload`) stay decimal.

GPX export (Export FAB, `fabs.gpxExport` / `onExportGpx` in `map/controls/MapControls.tsx`, a direct-action button in the no-panel `toggles` list, not a toggle: its `active` is left `undefined` so no `aria-pressed` is rendered): `MapView`'s `handleExportGpx` re-derives the raw (pre-effective-location) contact objects behind `mappableContacts` via `contactByKey`, so the pure `utils/gpxExport.ts` (`buildNodesGpx`) can tell an advertised location from a manual-fallback one (noted in the waypoint `<desc>`) from the original `lat`/`lon`/`manual_lat`/`manual_lon` fields. It best-effort calls `api.bulkContactUris` (`POST /contacts/bulk-contact-uris`) for a `meshcore://` link per node from stored raw adverts (never the radio); a lookup failure still downloads the GPX, just without links. Downloads `rtfm-ev-nodes-<date>.gpx` (waypoints only, no tracks; a node with no usable location is skipped).
The guessed-locations overlay (pure logic in `map/guessedLocations.ts`, layer in `map/layers/guessedLocationsLayer.ts`, wired by `map/useGuessedLocations.ts`) estimates a position for a contact with no effective location: it fetches `GET /contacts/repeaters/advert-paths` (despite the name, this returns paths for all contacts) while its FAB toggle is on (`remoteterm-map-guessed-locations`), then for every unlocated contact heard in the last 24h, resolves each known path's `next_hop` (the hop nearest the origin — RTFM-EV stores `path_hex` as `origin -> ... -> self`, the opposite array convention from meshcore-open's own reversed `Contact.path`) against a same-render index of located repeaters, using only 2-/3-byte hops (1-byte hops collide too often). Anchors farther apart than `2 * ESTIMATED_LORA_RANGE_KM` (a fixed 15 km estimate, not a live radio read, so the layer still works with no radio connected) are dropped as mutually inconsistent; the guess is placed 330 m off a single anchor or 80-120 m off a weighted centre of several (biased toward the freshest anchor, normalized by the true weight sum — see the module doc for the divide-by-anchor-count bug this fixes relative to meshcore-open), at an angle seeded from the contact's public key so it is stable across renders. Guesses are drawn as a hollow "~" marker (never a filled circle, so they cannot be mistaken for a real position), shown only at zoom 12+, and are never persisted, exported or sent anywhere.
Backend tile cache routing lives in `map/engine/tileProxy.ts`. `main.tsx` calls `loadTileProxyConfig()` once (`GET /tiles/config`); `SettingsTileCacheSection` calls `setTileProxyConfig` after every save so a toggle takes effect without a reload. `MapSurface` passes `transformTileRequest` as MapLibre's `transformRequest`, and the two direct style fetches (`basemaps.ts` recolour, `buildings3D.ts`) go through `proxiedUrl`. Only URLs starting with a `client_prefixes` entry of a `proxy: true` source are rewritten (to `./api/tiles/proxy/<source>/<path>`); anything with a query string, and every Esri URL, stays direct. The server's allow-list is the single source of truth; do not hard-code prefixes in the frontend.

State: `useConversationNavigation` controls open/close via `infoPaneContactKey`. Live contact data from WebSocket updates is preferred over the initial detail snapshot.

### Desktop full-page view vs. mobile Sheet

`handleOpenContactInfo` (`useConversationNavigation`) forks on `useIsMobile()` (`max-width: 768px`, from `map/controls/breakpoints.ts`):

- **Mobile** keeps the `ContactInfoPane` Sheet (right drawer) described above, via `infoPaneContactKey`.
- **Desktop** navigates to a routed full-page view: a new `contact-info` conversation type (`#contact-info/<pubkey>/<label>`, wired through `urlHash.ts` and `useConversationRouter` phase-2 resolution like `#contact`). `ConversationPane` renders `ContactInfoView`, which centres in a max-width container and lays the sections out in three curated columns (Identity & actions / Your data & telemetry / Network & activity).

The section stack is shared: `ContactInfoBody` (region-aware: `all` for the Sheet's single column, `identity`/`data`/`network` for the desktop columns) is rendered by both `ContactInfoPane` and `ContactInfoView`. Both load data through the shared `useContactInfoData(contactKey)` hook. `ContactInfoBody` exports `contactTypeLabel` and the name-only helpers the pane still uses.

On desktop, a repeater (`type=2`) or room (`type=3`) `#contact/<pubkey>` link also renders `ContactInfoView` (desktop convergence in `ConversationPane`), so shared links no longer dead-end on a bare login. The login/dashboard is embedded inline as a minimizable region (`RepeaterDashboardBody` for repeaters, `RoomServerPanel` for rooms). Mobile keeps the standalone `RepeaterDashboard` / `RoomServerPanel` surfaces.

## Channel Info Pane

Clicking a channel name in `ChatHeader` opens a `ChannelInfoPane` sheet (right drawer) showing channel details fetched from `GET /api/channels/{key}/detail`:

- Header: channel name, key (clickable copy), type badge (hashtag/private key), on-radio badge
- Favorite toggle
- Message activity: time-windowed counts (1h, 24h, 48h, 7d, all time) + unique senders
- First message date
- Top senders in last 24h (name + count)

State: `useConversationNavigation` controls open/close via `infoPaneChannelKey`. Live channel data from the `channels` array is preferred over the initial detail snapshot.

## Repeater Dashboard

For repeater contacts (`type=2`) on **mobile**, `ConversationPane.tsx` renders `RepeaterDashboard` instead of the normal chat UI (ChatHeader + MessageList + MessageInput). On **desktop** the dashboard is embedded (minimizable) inside the full-page `ContactInfoView` instead - see "Desktop full-page view vs. mobile Sheet". The header (name/pubkey/status/actions) lives in `RepeaterDashboard`; the login form + pane grid live in `RepeaterDashboardBody`, which both the standalone view and the embedded region reuse.

**Login**: `RepeaterLogin` component - password or guest login via `POST /api/contacts/{key}/repeater/login`. The frontend sends exactly one request; the backend internally escalates a timed-out login to one flood retry (see `app/AGENTS.md` § "Server login route escalation"), so a single call may take up to two response windows. Do not add a client-side login retry loop on top - a `LOGIN_FAILED` result means the password was refused, not that the route needs another attempt.

**Dashboard panes** (after login): Telemetry, Node Info, Neighbors, ACL, Radio Settings, Regions, Advert Intervals, Owner Info - each fetched via granular `POST /api/contacts/{key}/repeater/{pane}` endpoints. The Owner Info pane consumes `owner_info_updated` / `stored_owner_info`: it notes when the repeater's reported owner was auto-saved to the contact (empty case) and offers an override button when a different value is already saved (which calls `api.updateContactAnnotations`). The Regions pane prefers the admin CLI hierarchy and falls back to the guest anon flood-allowed names, so its payload carries a `source` of `cli` or `anon`. Panes retry up to 3 times client-side. `Neighbors` depends on the smaller `node-info` fetch for repeater GPS, not the heavier radio-settings batch. "Load All" fetches all panes serially (parallel would queue behind the radio lock).

**Settings Editor pane** (`RepeaterSettingsEditorPane.tsx`, defs in `repeaterSettingsDefs.ts`): editable rows for the allow-listed settings, seeded from the Radio Settings / Advert Intervals / Node Info / Owner Info pane data, plus a "Read current values" button (`api.repeaterSettingsRead`, `get` only, not part of Load All). Every change goes edit -> confirm (setting, current value, new value, exact CLI command) -> `api.repeaterSettingSet` (one `set` + `get` read-back) -> result (ok / mismatch / rejected / unverified). Radio f/bw/sf/cr is one `set radio` behind a strong confirm (type the repeater name; stranding + reboot warning). The client validators mirror `app/services/repeater_settings.py`, which stays the authority. After a verified read-back the hook's `applySetting` patches the matching read-only pane data (`applyReadbackToPaneData`).

**Actions pane**: Send Advert, Sync Clock, Reboot - all send CLI commands via `POST /api/contacts/{key}/command`.

**Console pane**: Full CLI access via the same command endpoint. History is ephemeral (not persisted to DB).

All state is managed by `useRepeaterDashboard` hook. State resets on conversation change.

## Room Server Panel

For room contacts (`type=3`) on **mobile**, `ConversationPane.tsx` keeps the normal chat surface but inserts `RoomServerPanel` above it. That panel handles room-server login/status messaging and gates room chat behind the room-authenticated state when required. On **desktop**, the room lands on the full-page `ContactInfoView` with `RoomServerPanel` embedded in the minimizable login region (see "Desktop full-page view vs. mobile Sheet").

`ServerLoginStatusBanner` is shared between repeater and room login surfaces for inline status/error display.

## Message Search Pane

The `SearchView` component (`components/SearchView.tsx`) provides full-text search across all DMs and channel messages. Key behaviors:

- **State**: `targetMessageId` is shared between `useConversationNavigation` and `useConversationMessages`. When a search result is clicked, `handleNavigateToMessage` sets the target ID and switches to the target conversation.
- **Same-conversation clear**: when `targetMessageId` is cleared after the target is reached, the hook preserves the around-loaded mid-history view instead of replacing it with the latest page.
- **Persistence**: `SearchView` stays mounted after first open using the same `hidden` class pattern as `CrackerPanel`, preserving search state when navigating to results.
- **Jump-to-message**: `useConversationMessages` handles optional `targetMessageId` by calling `api.getMessagesAround()` instead of the normal latest-page fetch, loading context around the target message. `MessageList` resolves the target to an index and calls `virtualizer.scrollToIndex(...)`, then applies a `message-highlight` CSS animation. A pending target suppresses the bottom-pin (see Virtualization below), since the around-load clears the list first and would otherwise be yanked to the newest message.
- **Bidirectional pagination**: After jumping mid-history, `hasNewerMessages` enables forward pagination via `fetchNewerMessages`. The scroll-to-bottom button calls `jumpToBottom` (re-fetches latest page) instead of just scrolling.
- **WS message suppression**: When `hasNewerMessages` is true, incoming WS messages for the active conversation are not added to the message list (the user is viewing historical context, not the latest page).

## Web Push Notifications

Web Push allows notifications even when the browser tab is closed. Requires HTTPS (self-signed OK).

- **Service worker**: `frontend/public/sw.js` handles `push` events (show notification) and `notificationclick` (focus/open tab, navigate via `url_hash`). Registered in `main.tsx` on secure contexts only.
- **`usePushSubscription` hook**: manages the full subscription lifecycle - subscribe (register SW → `PushManager.subscribe()` → POST to backend), unsubscribe, global push-conversation toggles, device listing, and deletion.
- **ChatHeader integration**: `BellRing` icon (amber when active) appears next to the existing desktop notification `Bell` on secure contexts. First click subscribes the browser and enables push for that conversation; subsequent clicks toggle the conversation on/off.
- **Settings > Local**: `PushDeviceManagement` component shows subscription status, lists all registered devices with test/delete buttons. Uses `usePushSubscription` hook directly.
- Auto-generates device labels from User-Agent (e.g., "Chrome on macOS").
- `PushSubscriptionInfo` type in `types.ts`; API methods in `api.ts`.

## New-Node Notifications

Browser notification only (no Web Push) for the WS `new_node` event (plan 28
item 1.5) - a public key never stored before, or a batched summary on a busy
mesh (see `app/AGENTS.md` "New-node notifications" for the backend
batching/warm-up).

- **`useNewNodeNotifications` hook**: local-only preference, off by default,
  same storage model as `useBrowserNotifications`' per-conversation toggle
  (`localStorage`, gated on the `Notification` permission, no server
  `app_settings` field). Stores `{ enabled, types }` under
  `meshcore_new_node_notifications_settings`; `types` is contact type codes
  (1=Client, 2=Repeater, 3=Room, 4=Sensor) to notify for, defaulting to all
  four once enabled.
- **Wiring**: `App.tsx` calls the hook once and threads `handleNewNodeEvent`
  into `useRealtimeAppState`'s `notifyNewNode`, which fires on every WS
  `new_node` event exactly like `notifyIncomingMessage` does for `message`.
  The backend always broadcasts truthfully regardless of any browser's
  preference; this hook does the per-browser filtering and notification
  construction.
- **Single vs batch**: a single-node payload (`batched: false`) shows the
  contact name/type and clicking deep-links to `#contact/<key>/<label>` (same
  pattern as `useBrowserNotifications`' message deep link). A batched payload
  (`batched: true`) sums only the counts for the browser's enabled types from
  `types` (a per-type breakdown) - if that sum is zero the notification is
  suppressed entirely; otherwise it shows a plural "N new nodes" summary and
  clicking clears the hash (opens the default view with the sidebar/contacts
  visible) rather than deep-linking to one contact.
- **Settings > Local**: a "New node notifications" group (`SettingsLocalSection.tsx`,
  reusing `contactTypeLabel` from `ContactInfoBody.tsx` for the four type
  checkboxes) sits next to the mention-sound group. Enabling requests the
  `Notification` permission the same way the per-conversation toggle does.

## Styling

UI styling is mostly utility-class driven (Tailwind-style classes in JSX) plus shared globals in `index.css` and `styles.css`.
Do not rely on old class-only layout assumptions.

### Canonical style reference

`SettingsLocalSection.tsx` contains a **ThemePreview** component with a collapsible "Canonical style reference" section. This is the authoritative catalog of text sizes, button variants, badge patterns, and interactive elements used throughout the app. **When adding or modifying UI, match the patterns shown there rather than inventing new ones.**

Key conventions documented in the reference:

- **Text sizes** use `rem`-based Tailwind values so they scale with the user's font-size slider. Do not use hard-locked `px` values (e.g., `text-[10px]`). The canonical sizes are `text-[0.625rem]` (10px), `text-[0.6875rem]` (11px), `text-[0.8125rem]` (13px), plus standard Tailwind `text-xs`/`text-sm`/`text-base`/`text-lg`/`text-xl`.
- **Group titles** (sub-section headings within settings tabs) use `<h3 className="text-base font-semibold tracking-tight">`. These separate major groups like "Connection", "Identity", "MQTT Broker". When a group contains named sub-items (e.g. "Contact Management" → "Blocked Contacts", "Bulk Delete"), use `<h4 className="text-sm font-semibold">` for the children and nest them inside the parent group's `div` instead of separating with `<Separator />`.
- **Helper / description text** uses `text-[0.8125rem] text-muted-foreground` (13px). This is for explanatory paragraphs under inputs or sections - not for metadata, timestamps, or alert text which stay at `text-xs`.
- **Metadata labels** use `text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium` for compact category tags like "Push-enabled conversations" or "Registered Devices".
- **Buttons** use the shadcn `<Button>` component. Semantic color overrides (danger, warning, success) use `variant="outline"` with `className="border-{color}/50 text-{color} hover:bg-{color}/10"`.
- **Badges/tags** use `text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded` with `bg-muted` (neutral) or `bg-primary/10` (active).
- **Clickable text** (copy-to-clipboard, navigational links) uses `role="button" tabIndex={0}` with `cursor-pointer hover:text-primary transition-colors`.

### Region-scope adoption panel

`MeshTrendsHistoricalPanel.tsx` (Mesh Trends "Historical" tab) renders `stats.region_scope_24h` via `RegionScopeStatsPanel`. Two presentation rules exist because regional adoption is currently very sparse, and both are deliberate:

- **Fractions, not bare percentages.** "3 of 117" carries the sample size that "2.6%" hides.
- **The traffic percentage is withheld** when the scoped count is at or below `false_positive_floor` (corrupt-capture noise) or when the share would round to `0.0%`. The floor caveat is always shown alongside a non-zero scoped count. The sender figure is never suppressed - it requires successful decryption and so carries no noise.

Traffic and sender figures use different denominators (all channels vs. decryptable-only) and are not expected to match.

## Security Posture (intentional)

- No authentication UI.
- Frontend assumes trusted network usage.
- Bot editor intentionally allows arbitrary backend bot code configuration.

## Testing

Run all quality checks (backend + frontend) from the repo root:

```bash
./scripts/quality/all_quality.sh
```

Or run frontend checks individually:

```bash
cd frontend
npm run format:check   # Prettier; CI gate. Run `npm run format` to fix.
npm run lint
npm run test:run
npm run build
```

`format:check` is a required CI check (`frontend-checks`): a PR goes red if any
file under `src/` is not Prettier-clean. Run `npm run format` before committing
frontend changes, or format just the files you touched
(`npx prettier --write <paths>`).

Windows caveat: a local `npm run format:check` flags every file with CRLF line
endings (Prettier is configured `endOfLine: lf`), so it can report hundreds of
false positives from your checkout, not your edits. CI checks out LF and only
fails on real formatting issues. To see whether *your* change is clean without
the CRLF noise, run `npx prettier --check` on the specific files you edited, or
trust CI. Do not "fix" files you did not touch.

`npm run packaged-build` is release-only. It writes the fallback `frontend/prebuilt`
directory used by the downloadable prebuilt release zip; normal development and
validation should stick to `npm run build`.

When touching cross-layer contracts, also run backend tests from repo root:

```bash
PYTHONPATH=. uv run pytest tests/ -v
```

## Errata & Known Non-Issues

### Contacts use mention styling for unread DMs

This is intentional. In the sidebar, unread direct messages for actual contact conversations are treated as mention-equivalent for badge styling. That means both the Contacts section header and contact unread badges themselves use the highlighted mention-style colors for unread DMs, including when those contacts appear in Favorites. Repeaters do not inherit this rule, and channel badges still use mention styling only for real `@[name]` mentions. Reactions are not mentions even though a channel reaction names its target (`@[Name]👍` plus a hash line): `messageContainsMention` skips them via `isReactionPayload`, and the backend unread query does the same through the `is_reaction_text` SQL function (`app/reaction_payloads.py`).

### RawPacketList autoscroll, pause, and fold

`RawPacketList` sticks to the latest packet on every update when its `autoScroll` prop is true (the default). Both packet tabs expose an "Autoscroll" checkbox (default ticked, session-only - intentionally not persisted). With `autoScroll` off in newest-first mode the list would otherwise keep pushing the read rows down as new packets prepend, so a `useLayoutEffect` compensates `scrollTop` by the height the list grew, holding the viewed rows in place (oldest-first needs none - new rows append below the fold). Toggling autoscroll back on jumps to the newest edge immediately.

Both tabs also have a **Pause** button. Pausing snapshots the current list into view state and freezes the display; incoming packets keep flowing into the store but are only counted behind a "N new" badge until Resume. On Packet History the button is disabled outside a live preset and the snapshot is cleared when leaving live mode. Session-only.

The Filters modal's **"Group repeats by content"** toggle drives `RawPacketList`'s `groupByContent` prop, which folds packets sharing content (same payload across different paths) into one row badged `×N`. The fold key comes from `utils/rawPacketContent.ts` (`getRawPacketContentKey` strips the routing path via `analyzeStructure` and caches per packet; `foldPacketsByContent` groups, representative = newest sighting).

### RawPacketFeed sort order

`RawPacketFeedView` has a "Sort order" `<select>` (Oldest first / Newest first) next to the Filters button. It drives `RawPacketList`'s `newestFirst` prop, which flips the timestamp sort. Autoscroll sticks to the newest packet's edge in either direction (bottom for oldest-first, top for newest-first). Unlike autoscroll, the choice is persisted server-side in `app_settings.packet_feed_sort` (`'oldest' | 'newest'`, default `'oldest'`) and threaded down from `App.tsx` via `conversationPaneProps` (`packetFeedSort` + `onSaveAppSettings`).

### Mesh Health contacts-table page size

`MeshAdvertsPanel`'s "All Advertised Contacts Heard" table has a "Show max rows" `<select>` (10/25/50/100/All) in the block header. It drives the existing client-side pager; `All` (value `0`) renders every row and hides the pager. The choice is persisted server-side in `app_settings.mesh_health_page_size` (`int`, `0` = all, default `50`) and threaded from `App.tsx` via `conversationPaneProps` (`meshHealthPageSize` + `onSaveAppSettings`) → `MeshHealthView` (`pageSize`) → `MeshAdvertsPanel`. Same convention as `packet_feed_sort` above.

## Editing Checklist

1. Run `npm run format` (Prettier) before committing; `format:check` is a CI gate. See Testing for the Windows CRLF caveat.
2. If API/WS payloads change, update `types.ts`, handlers, and tests.
3. If URL/hash behavior changes, update `utils/urlHash.ts` tests.
4. If read/unread semantics change, update `useUnreadCounts` tests.
5. Keep this file concise; prefer source links over speculative detail.

## Internationalization (i18n)

User-facing strings are localized (EN default, plus NL and DE). See the spec at
`docs/superpowers/specs/2026-09-10-i18n-en-nl-de-design.md`.

Rules for new strings:

- Never hardcode a user-facing literal. Call `t('key')` from `useT()`
  (`src/i18n`). This covers visible text, `aria-label`, `placeholder`, `title`,
  `alt`, and Sonner `toast.*` messages.
- Keys are flat `snake_case` with a domain prefix: `common_`, `nav_`, `chat_`,
  `contact_`, `channel_`, `repeater_`, `packet_`, `map_`, `settings_`, `toast_`,
  `visualizer_`, `command_`, `a11y_`, `error_`. Add a prefix if a new domain
  appears.
- Add every key to all three catalogs: `src/i18n/locales/{en,nl,de}.json`.
  `en.json` is the source of truth; the parity test (`src/test/i18nParity.test.ts`)
  fails if the key sets differ. If a NL/DE translation is unknown, copy the
  English value - the runtime falls back to English anyway.
- Interpolation uses single-brace `{name}` tokens; pass params as
  `t('key', { name: value })`.
- Counted strings use a plural object `{ "one": "...", "other": "..." }` and are
  called with `{ count }`; `Intl.PluralRules` selects the form. Do not hand-roll
  `count !== 1 ? 's' : ''`.
- Do NOT translate brand/protocol tokens (MeshCore, RTFM, channel keys, hex
  pubkeys), log lines, or test fixtures.
- Locale-aware number/date formatting: use `src/utils/localeFormat.ts` or pass the
  active locale (from `useLocale()`) to `Intl`/`toLocaleString`.

Translation strings for NL/DE are adapted in part from kiekr-i18n by Marcel
Verdult (@marcelverdult), https://github.com/marcelverdult/kiekr-i18n, CC-BY 4.0.

### Triangulation link-out (plan [13])

`utils/triangulatorLink.ts` builds `https://triangulator.dutchmeshcore.nl/?prefixes=<first 6 hex>` for a node (the DMC triangulator's own deep-link form: 2/4/6-hex path-hash prefixes, optional `:count` weights, `prefixes2`, `hop2`, `cluster`; it auto-runs discovery from the public mc-radar / map.meshcore.io feeds). Shown as "Triangulate on triangulator.dutchmeshcore.nl" in the contact info identity section (`ContactInfoBody`, independent of configured analyzer sites) and as a "Triangulate" link in the map node popup (`MapView.buildContactPopup`). It is a link-out, not an embedded estimator: the plan rejected a from-scratch port as a separate large plan.
