# Frontend AGENTS.md

This document is the frontend working guide for agents and developers.
Keep it aligned with `frontend/src` source code.

## Stack

- React 19 + TypeScript 6
- Vite
- Vitest + Testing Library
- shadcn/ui primitives
- Tailwind CSS 4 utility classes + local CSS (`index.css`, `styles.css`). There is no `tailwind.config.js`: the theme is the `@theme` block in `index.css`
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
- Values used as hook dependencies keep the same reference while unchanged: a module-level empty array instead of `|| []`, `useMemo` for derived lists, and refs read inside a memoized handler object listed in its dependencies.

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
│   ├── MessageLayoutContext.tsx # MessageList row layout: 'bubbles' (default), 'lines' (chat popup) or 'cards' (Atlas layout)
│   └── PushSubscriptionContext.tsx # Push subscription state context/provider
├── lib/
│   └── utils.ts            # cn() - clsx + tailwind-merge helper
├── networkGraph/
│   └── packetNetworkGraph.ts # Packet→network graph construction shared by visualizer surfaces
├── popout/                 # Chat-only popup window (`?popout=chat|single`), see "Chat popup"
│   ├── popoutMode.ts       # Mode from the URL, popup/main URLs, window.open helpers, chat-vs-tool check
│   ├── ChatPopoutShell.tsx # Popup shell: toolbar, conversation list, ConversationPane, recent senders
│   ├── popoutLists.ts      # Pure: conversation list sections + recent senders
│   ├── popoutSkin.ts       # Skin (mirc / mirc-dark / theme) + layout persistence, applied without saving the theme
│   ├── mainPresence.ts     # BroadcastChannel "is a main tab open?" (popup stays silent if so)
│   └── popout.css          # mirc / mirc-dark tokens and bevels (imported in main.tsx)
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
│   ├── useSoftResolutions.ts       # Applied prefix -> node soft links (plan 16), loaded per mount, keyed by lowercase prefix
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
│   ├── deviceConfigHistory.ts  # Plan 14 repeater pane snapshots: group by kind + diff vs previous (buildConfigHistory)
│   ├── pathUtils.ts            # Distance/validation helpers for paths + map
│   ├── traceMapUtils.ts        # Pure helpers: trace-result node locations + solid/dashed map segments (TraceRouteMap)
│   ├── pubkey.ts               # getContactDisplayName (12-char prefix fallback)
│   ├── contactAvatar.ts        # Avatar color derivation from public key
│   ├── rawPacketIdentity.ts    # observation_id vs id dedup helpers
│   ├── rawPacketStats.ts       # Session packet stats windows, rankings, and coverage helpers
│   ├── regionScope.ts          # Regional flood-scope label/normalization helpers
│   ├── meshcoreOpenPayloads.ts # Rich MeshCore Open payload detection/rendering helpers
│   ├── teamPayloads.ts         # MeshCore TEAM / signalk-meshcore payload parsing (#TEL:, #T:, #WAY:, #WRC:, #CAP:) + #WAY:/#TEL: builders for the composer
│   ├── textReplace.ts          # Shared message text substitution helpers
│   ├── pathHopWidthPreference.ts # LocalStorage persistence for hop-width display toggle
│   ├── messageHopFilterPreference.ts # Chat "Hide unscoped" filter (localStorage) + read/clear of the legacy local "Hide by hop size" key (the hop filter now lives in app_settings.hidden_hop_widths; useAppSettings migrates the old key once)
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
│   ├── Sidebar.tsx             # Conversation list; Customize panel (section/tool/favorites-group reorder+hide) + Contact Groups (create/rename/delete); each contact_group renders as its own reorderable/hideable/collapsible section with a per-group A-Z/recent sort toggle (`sort_order`, persisted in the group) (see sidebarLayout.ts); `owned` section (plan 17 phase 3): contacts whose `owner_key` equals the radio's public key (`ownPublicKey` prop, from App `config`), bucketed by type, rendered only when non-empty
│   ├── ChatHeader.tsx          # Conversation header (trace, favorite, delete)
│   ├── MessageList.tsx        # Message rows; #hashtag refs styled by state (followed/known/unknown) with an inline "+" to capture unknowns into the registry (auto-capture via app_settings.auto_add_mentioned_channels); hover React/Reply/Mark-unread/Delete (MessageRowActions) and reaction-target links (ReactionTargetLink); inline `<pubkey:type:Name>` contact shares (utils/chatEntities `findContactShares`, always tokenized, priority over the bare-pubkey scanner) render as ContactShareToken: known contact opens info, unknown shows name/type/short key + "Add contact" via `onAddSharedContact` (App: `handleCreateContact(name, key, false, type)`); rows with txt_type === TXT_TYPE_GROUP_DATA (GRP_DATA channel datagrams, marker text `[image] id=.. chunks=..` / `[data] type=.. len=..`) render an "Image (not supported)" / "Data (not supported)" placeholder instead of the text; view filters "Hide by hop size" (controlled by `hiddenHopWidths` from app_settings, saved via `onHiddenHopWidthsChange`) and "Hide unscoped" (localStorage) hide incoming rows except the jump target, and the unread divider moves to the first visible unread message (none when all unread rows are hidden)
│   ├── MessageInput.tsx
│   ├── NewMessageModal.tsx     # Contact / Contact link (meshcore:// import) / channel tabs
│   ├── ContactLinkShare.tsx    # On-demand meshcore:// link with copy (contact info + Settings > Radio)
│   ├── ChannelImportExportModal.tsx # Channel text-file export/import + Communities tab
│   ├── CommunitiesPanel.tsx    # meshcore-open communities: join (paste JSON / camera / QR image), add hashtag, export JSON/QR
│   ├── SearchView.tsx          # Full-text message search pane
│   ├── SettingsModal.tsx       # Layout shell - delegates to settings/ sections
│   ├── RawPacketList.tsx
│   ├── RawPacketFeedView.tsx   # Live raw packet feed (list + filters + inspector); stats moved to Mesh Trends
│   ├── RawPacketDetailModal.tsx # On-demand packet inspector dialog + RawPacketPasteInspector (shared paste-hex body)
│   ├── MeshTrendsView.tsx      # Tools view: Live / Historical tabs (consolidated stats)
│   ├── KnowledgeBaseView.tsx   # Tools view "Knowledge base" (#knowledge-base): Handy Info links with `kb` set, grouped by category; add = flagged custom link, remove = unflag (handy_info overlay)
│   ├── ManualView.tsx          # Tools view "User Guide" (#manual): renders content/manual/{en,nl,de}.md for the active locale (EN fallback) with a section TOC; TOC scrolls in-pane and never changes the hash
│   ├── PacketFeedStatsPanel.tsx # Live tab: session packet-stat breakdowns (reads rawPacketStore)
│   ├── MeshTrendsHistoricalPanel.tsx # Historical tab: server-backed stats (GET /api/statistics)
│   ├── MeshRelayReceptionPanel.tsx # Mesh Health "Relay reception" tab: paged packets x relays pivot (rows per page in localStorage) + uncapped relay summary with expandable rows, live refresh (plan 21 S1)
│   ├── MeshRelayDetail.tsx     # Expanded relay row: totals, activity + signal charts, packet types, hop counts, recent copies
│   ├── AnalyzePacketView.tsx   # Tools view: standalone paste-a-hex packet inspector
│   ├── MeshDiscoveryView.tsx   # Tools view: mesh discovery sweep (repeaters/sensors) + last-sweep results + repeater region discovery
│   ├── SnmpView.tsx            # Tools view "SNMP" (#snmp): every node with SNMP set up; sortable overview table, a row opens the node page, Poll now / Poll all now
│   ├── SnmpNodeView.tsx        # Tools view "SNMP" for one node (#snmp/<public key>): tiles, time range, graphs of stored polls (rates/totals), latest values, Poll now
│   ├── MapView.tsx
│   ├── TracePane.tsx           # Multi-hop route trace builder/results view
│   ├── VisualizerView.tsx
│   ├── PacketVisualizer3D.tsx
│   ├── PathModal.tsx
│   ├── PathRouteMap.tsx
│   ├── TraceRouteMap.tsx        # Draws a TracePane result on a map (hops at known/manual locations, dashed gap over skipped hops, SNR tooltip); shares marker/colour helpers with PathRouteMap via map/routeMapVisuals.ts
│   ├── CrackerPanel.tsx       # Browser channel finder; wordlist = bundled ENGLISH_WORDLIST + remote sync + registry names ("Sync from channels" button, meshcore-wordlist-registry-cache)
│   ├── ContactAvatar.tsx
│   ├── ContactInfoPane.tsx     # Contact detail sheet (mobile; wraps ContactInfoBody)
│   ├── ContactInfoBody.tsx     # Shared contact-info section stack (region-aware: Sheet + full page)
│   ├── ContactInfoView.tsx     # Desktop full-page contact info (3 columns + minimizable repeater/room login)
│   ├── ContactStatusInfo.tsx   # Contact status info component
│   ├── ContactPathDiscoveryModal.tsx # Forward/return path discovery dialog
│   ├── ContactRouteSuggestions.tsx   # Suggested DM routes for companions + on-request analyzer check
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
│   ├── shell/                  # Pieces of the app shell shared by the classic and the Atlas layout (AppBrand, ThemeSettingsDialog, AtlasSidebar head/foot)
│   ├── DirectTraceIcon.tsx     # Shared direct-trace glyph used in header/dashboard
│   ├── NeighborsMiniMap.tsx    # Leaflet mini-map for repeater neighbor locations
│   ├── settings/
│   │   ├── settingsConstants.ts          # Settings section type, ordering, labels
│   │   ├── SettingsRadioSection.tsx      # Name, keys, advert interval, max contacts, radio preset, freq/bw/sf/cr, txPower, lat/lon, reboot, known regions
│   │   ├── SettingsLocalSection.tsx      # Browser-local settings: theme, relative font scale, local label, reopen last conversation
│   │   ├── SettingsFanoutSection.tsx     # Fanout integrations: MQTT, webhooks, config CRUD
│   │   ├── SettingsRadioAppSection.tsx    # Radio-App Management: tracked telemetry, contact management, blocked lists, partial-node sync, loadouts (channel sets)
│   │   ├── ChannelSetsSettings.tsx        # Loadouts (channel sets, plan 08): save named groups of channels + contacts, "Load onto radio" with per-channel slot and per-contact results (/api/channel-sets)
│   │   ├── LoadoutDisconnectDialog.tsx    # Plan 08 slice 3: Disconnect (Settings > Radio) offers to load a loadout first; asks again when anything failed
│   │   ├── PartialNodeSyncModal.tsx       # Review + apply soft resolutions of partial nodes vs the external-map cache; lists applied soft links (collapsed) with a per-row remove (DELETE /partial-resolutions/{prefix})
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
│   │   ├── RepeaterConfigHistoryPane.tsx # Stored pane snapshots with per-change diffs (plan 14)
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

High-level state is delegated to hooks:
- `useAppShell`: app-shell view state (settings section, sidebar, cracker, new-message modal)
- `useRadioControl`: radio health/config state, reconnect/reboot polling
- `useAppSettings`: settings CRUD, favorites, preferences migration
- `useContactsAndChannels`: contact/channel lists, creation, deletion
- `useConversationRouter`: URL hash → active conversation routing
- `useConversationNavigation`: search target, conversation selection reset, and info-pane state
- `useConversationActions`: send/resend/trace/path-discovery/block handlers and channel override updates
- `useConversationMessages`: conversation switch loading, embedded conversation-scoped cache, jump-target loading, pagination, dedup/update helpers, reconnect reconciliation, and pending ACK buffering
- `useUnreadCounts.loadUnreads` treats a `/unreads` answer as a snapshot: only the newest call may apply its result (`unreadRequestVersionRef`), and when local unread state changed during the request (`unreadMutationVersionRef`, bumped by a live message, a navigation, mark-read, rename or removal) it fetches again, at most `UNREAD_FETCH_MAX_ATTEMPTS` (3) in total, applying the last answer regardless.
- `useUnreadCounts` also persists reads for the open conversation: an incoming message there schedules `markChannelRead`/`markContactRead(id, messageId)` (250 ms debounce, newest boundary wins, flushed when the conversation changes). Not scheduled while `suppressAutoReadKeyRef` holds that conversation unread.
- `useUnreadCounts`: unread counters, mention tracking, recent-sort timestamps, server `last_read_ats`, `first_unread_ids` (the unread-divider anchor), and `markConversationUnreadFromMessage` ("mark unread from here")
- `useRealtimeAppState`: typed WS event application, reconnect recovery, cache/unread coordination; incoming messages hidden by the hop-size filter (`hiddenHopWidthsRef`) are stored but raise no unread count, recency bump, notification, sound or mention ticker, like a muted channel; the same applies to messages the server flagged `malformed` while the "Hide malformed" filter is on (`hideMalformedRef`, app setting `hide_malformed`)
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

### Chat popup (`popout/`)

The **Chat window** button in `StatusBar` opens the same SPA with `?popout=chat` (multi-chat) or `?popout=single` (one detached conversation); the conversation stays in the hash, so `useConversationRouter` is unchanged. `App.tsx` reads the mode once (`getPopoutMode`) and then:

- renders `ChatPopoutShell` instead of `AppShell`, passing the same prop bundles. The shell reuses `ConversationPane` as it is, so chat behaviour cannot drift from the main app. It does not mount `Sidebar`, `StatusBar`, `BuddyHost`, `CommandPalette`, `CrackerPanel`, `MentionTicker`, `SettingsModal` or `RadioIdentityPrompt`.
- skips the raw packet seed and connects with `useWebSocket(handlers, 'chat')` (`/api/ws?events=chat`).
- passes `redirectConversation` to `useConversationRouter`: selecting anything that is not a channel, a non-repeater contact or search calls `openInMainApp` and is dropped. A popup opened on a non-chat hash shows a placeholder instead of the view.
- passes `forceInfoSheet` to `useConversationNavigation`, so contact info opens as the sheet (`ContactInfoPane`), never as the full-page `contact-info` view.
- gates `notifyIncomingMessage`, `notifyNewNode` and `notifyMentionSound` on `mainPresenceRef`: silent while a main tab answers on the presence channel. The main tab announces itself from `main.tsx`.

`MessageList` reads `useMessageLayout()`. Each row's content (body, badges, delivery status, URL preview, row actions) is built once as local pieces and placed by one of two wrappers; a change to a piece applies to both layouts. In `lines` the row actions float over the line end on hover (they would otherwise take ~100px from every line), and the virtualizer uses `ESTIMATED_LINE_HEIGHT` and calls `measure()` when the layout switches.

Skins: `applyPopoutSkin` sets `data-theme` (`mirc`, `mirc-dark`, or the saved theme) without calling `applyTheme`, so the saved theme is never changed; `mirc*` are not in `THEMES`. It also sets `data-popout-tone` (`light`/`dark`), which `popout.css` uses for the nick lightness, and forces the CRT effect attributes off under the mIRC skins. Not observable in jsdom: the real window layout, fonts and `window.open` behaviour; check those in a browser.

### Desktop buddy (`buddy/`)

`BuddyHost` (mounted once in `AppShell`) is a gate: it only tracks the preference and theme. Everything else (sprite download, polling, update checks) lives in the inner `ActiveBuddy` and runs only while a buddy is shown. App code never talks to the buddy directly: realtime handlers call `emitBuddyEvent` (`buddyEvents.ts`), which is a no-op without a listener.

- `buddyCatalog.ts` is the table of line kinds (`LINE_KINDS`: group and mood per kind) plus one builder per kind that returns a `BuddyLine` (`kind`, `group`, `mood`, `anchor`, `text`, `target`, `count`). Every line the buddy says goes through `say(line)` in `BuddyHost`. A new kind needs a row, a builder and a trigger; a new Tools page still needs its tip key in `PAGE_TIP_KEYS` (`buddyLogic.ts`).
- `say()` order: group switched off = dropped; quiet (mute or quiet hours, `isBuddyQuiet`) = stored in `buddyHistory.ts` as not shown and counted in `HeldBack` by `line.count` (a page tip is dropped instead and not marked as said); otherwise queued, capped at 3 pending lines. When quiet ends (checked every 20 s and on every prefs change) one `quiet-summary` line is said.
- Expression: `buddyMood.ts` maps a mood to an animation chain and `pickAnimation` takes the first one the character has (characters differ; Gourdy has none). `playBriefly` plays the mood animation before the text (3 s cap, then 1.5 s grace for the exit frames) and waits up to 4 s for a running idle animation to hand over before it starts that clock. The gesture toward `line.anchor` plays while the text is shown; the queue step completes when both are done.
- Anchors (`buddyAnchors.ts`): components tag an element with `data-buddy-anchor` (`Sidebar` conversation rows via `conversationAnchor`, and `status-radio` / `status-battery` / `status-update` in `StatusBar`). `findAnchorPoint` runs when the line is said and returns null for an element that is absent, has no size or is off screen; then there is no gesture. clippyjs only knows four directions.
- Prefs (`buddyPrefs.ts`, localStorage): `rtfm-buddy-groups-off`, `rtfm-buddy-mute-until` (a mute "until reload" is kept in memory only), `rtfm-buddy-quiet-hours`, `rtfm-buddy-battery-warned` (seed for `BatteryWatch`, so a reload does not repeat a warning). `BuddySettings` renders everything in Settings > Local Configuration and only the picker and threshold in the theme dialog (`compact`).
- Outages (`OutageWatch` in `buddyLogic.ts`, one instance in `ActiveBuddy`, warned keys persisted in `rtfm-buddy-services-warned`): a key warns once after it has been down for the grace period without a break and re-arms when it is seen up. `fanout:<config id>` comes from `health.fanout_statuses` (up = status `connected`, 60 s grace, checked on every health update and every 30 s); `snmp:<public key>` from `api.snmpNodes()` every 5 minutes (stored data only, nodes with `poll_enabled`, down = `last_error` set, no grace). Neither is tracked while the `services` group is switched off, so nothing is marked as warned that was never said. The buddy must never call `api.pollSnmp` or `api.discoverSnmpAddress`.
- Failed sends: `useRealtimeAppState.onMessageFailed` emits `send-failed` only for a `PRIV` message found in `conversationMessageCache` (`find`) whose chat is not the active conversation. A message this browser has not cached is not announced.
- Click menu (`BuddyMenu.tsx`, rendered by `ActiveBuddy` through a portal on `<body>`, same z-index as the balloon): a single click on the buddy opens it after the double-click window (250 ms), so the double-click trick is unchanged; a press that ended more than 5 px away was a drag. It closes on Escape, a press elsewhere, a press on the buddy, and when the buddy starts to speak (the balloon uses the same spot). Views: the menu and the recap (`getBuddyHistory()`, newest first). `BuddyTarget` has two kinds for it: `manual` (`requestManualSection` from `utils/manualNavigation.ts`, then the normal `manual` conversation; `ManualView` takes the section on mount or on the `rtfm-manual-section` event) and `recap` (the quiet summary's click target). `pageHelpSection` (`buddyLogic.ts`) maps a page to a User Guide section id; a new page needs an entry there to get "Help for this page". Every item navigates or changes a browser-local setting; none may call an endpoint that transmits.
- The buddy relies on clippyjs 0.1.0 private members; recheck them on any clippyjs upgrade: `_addToQueue`, `_balloon._balloon`, `_balloon.speak`, `_balloon.CLOSE_BALLOON_DELAY`, `_onQueueEmpty`, `_animator._data`, `_animator.exitAnimation`, `_animator.currentAnimationName`, `_playInternal`, `_getDirection`, and the `Animator.States` values (0 = exited, 1 = waiting). `playBriefly` and `gestureAnimation` guard their calls, so a missing member costs the animation, not the line.
- Not observable in jsdom: which animation frames play and how long they take. Check those in a browser (frames show as `background-position` on the `[data-buddy]` element).

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
- Byte limit: `MessageInput` does not send while the text is over the limit the counter shows (`overHardLimit`: Send disabled, Enter and form submit ignored, `aria-invalid`, hint `chat_too_long_to_send`). The firmware truncates an over-limit channel message (stored text then differs from on-air text and its echo is not recognised) and refuses an over-limit DM. A message that exactly fills the limit is sent.
- Unread summary: `ChannelUnreadSummaryBanner` (above the message list in `ConversationPane`) asks `api.summarizeChannelUnread(key, after)` once per channel open and renders nothing when the server returns no summary. `App.tsx` captures `summarizeAfter` (the channel's `last_read_at`) together with the unread marker, because opening the channel also marks it read, and passes `unreadSummaryAfter` only when `appSettings.ollama_enabled`. The banner's key must differ from the `MessageList` key (the conversation id): a shared key remounts it on every render and sends a request each time. Settings live in `settings/UnreadSummarySettings.tsx`.
- Contact region: the chat header globe and `ChannelFloodScopeOverrideModal` (`kind="contact"`) also serve contact conversations; `useConversationActions.handleSetContactFloodScopeOverride` calls `api.setContactFloodScopeOverride` and merges the returned contact.
- Unconfirmed sends: an outgoing message with `send_status === 'unknown'` and `acked === 0` gets a warning mark in front of the normal status (`chat_send_unconfirmed_title`). The radio never answered the send command, so the message may or may not be on air; the channel status/resend control next to it still works.
- Failed DMs: an outgoing DM with `failed_at` set and `acked === 0` shows a red "Failed" marker instead of the pending `?` (`acked > 0` always wins, so a late ACK shows as delivered). WS `message_failed` sets `failed_at` via `useConversationMessages.receiveMessageFailed`. `MessageRowActions` gets an `onRetry` (Retry button) only for such rows; `useConversationActions.handleRetryDirectMessage` calls `POST /api/messages/direct/{message_id}/resend`, removes the failed row (`removeMessage`) and adds the new copy. Other clients drop the failed row on WS `message_deleted`. Retry transmits over RF.
- Conversation-scoped message caching now lives inside `useConversationMessages.ts` rather than a standalone `messageCache.ts` module. If you touch message timeline restore/dedup/reconnect behavior, start there.
- `contact_resolved` is a real-time identity migration event, not just a contact-list update. Changes in that area need to consider active conversation state, cached messages, unread state keys, and reconnect reconciliation together.
- Deleting a message (`MessageRowActions` "Delete", after a `window.confirm`) calls `DELETE /api/messages/{id}` then removes it locally via `useConversationMessages`' `removeMessage` (active list + `conversationMessageCache`, any conversation). The backend's `message_deleted` WS event drives the same removal in every other open tab and re-fetches unread counts (`refreshUnreads`) rather than reproducing the count/first-unread-boundary math client-side. Local only; nothing is sent over RF.

### Visualizer behavior

- `VisualizerView.tsx` hosts `PacketVisualizer3D.tsx` (desktop split-pane and mobile tabs).
- `PacketVisualizer3D.tsx` is now a thin composition shell over visualizer-specific hooks/components in `components/visualizer/`.
- Soft links (plan 16): `useVisualizerData3D` passes `useSoftResolutions()` into `buildPacketNetworkContext({ softLinks })`. An ambiguous or unknown hop prefix the user linked (Settings > Radio-App Management, `PartialNodeSyncModal`) gets the linked node as its label and `probableIdentity` ("Probably: ..."), ahead of the advert-path guess; it stays `isAmbiguous`. `PathModal` does the same per hop ("Linked to X (soft link)", `data-testid="hop-soft-link"`) for hops with zero or several local matches.
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
- Mesh discovery (the Tools > Mesh Discovery view, `#mesh-discovery`) is limited to node classes that currently answer discovery control-data requests in firmware: repeaters and sensors. Sweep state lives in `useRadioControl`, so the last result survives navigation. The same view hosts repeater region discovery (formerly in Settings > Radio), which prefers repeaters from the last sweep and saves added regions straight to `known_regions`. An Advert panel at the top of the view has Direct (0 hop) and Flood advert buttons; both call `useRadioControl.handleAdvertise` (`POST /api/radio/advertise` with `mode` `zero_hop` / `flood`), the same handler as Settings > Radio > Send Advertisement, which stays where it is.
- Frontend `path_len` fields are hop counts, not raw byte lengths; multibyte path rendering must use the accompanying metadata before splitting hop identifiers.

### Radio identities (plan 18)

- `RadioIdentityPrompt.tsx` (mounted in `AppShell`) opens while `health.radio_identity.status === 'pending'`. `new_key`: new radio, or "replaces" an earlier radio that is not already replaced, with carry-over checkboxes (stats, owned nodes, note). `legacy_history`: whether pre-tracking history belongs to this radio. "Decide later" hides it per browser session (`sessionStorage`); it never blocks the app. The answer form (`RadioIdentityResolver`) is reused by `settings/RadioIdentitiesSettings.tsx`.
- Settings > Radio > Radios (`RadioIdentitiesSettings`) lists every radio with pending answers, the replacement link (carry-over toggles, undo) and a note. Every radio except the current one has **Remove radio**: a confirmation dialog with a checkbox (off by default) to also delete that radio's stat history (`api.removeRadio(id, deleteStats)`). It also renders when no radio is connected (`SettingsModal` "Radio is not available" branch).
- My Node charts read the active radio's lineage by default; `RadioStatPicker` (only when there is more than one radio or unassigned history) passes a `RadioStatFilter` to `api.getBatteryRange` / `getNoiseFloorHistory` / `getAirtimeRange`. With a filter set, live windows read from the DB instead of the in-memory samples.
- The sidebar Owned section matches `owner_key` against `ownPublicKey` plus `health.radio_identity.owned_keys`.

### Host repeater section (`components/settings/hostRepeater/`)

- Own settings section `host-repeater` (after `radio`), rendered from `SettingsModal`, which passes `floodScopeRegions` (`floodScopeRegions.ts`: app `flood_scope` + channel overrides, `#` stripped) and repeater contacts.
- `HostRepeaterRegions` edits the region map (`regionTree.ts` for tree order, parent choices and mapping a repeater region dump). An empty saved list is pre-filled in the draft only. The import calls `api.repeaterRegions`, which transmits, so it sits behind `window.confirm`; tests must mock it.

- `HostRepeaterSettings` edits one versioned settings document (`useHostRepeater`): validate via `POST .../validate`, then `PUT .../settings` with the loaded `version`; a 409 reloads. A WS `host_repeater` event reloads when there are no local edits, otherwise it shows a reload notice. On OpenHop radios it renders a disabled checkbox and a note only (no requests).
- Policy rules reuse `OpenHopPolicyEngineCard` / `OpenHopPolicyRules`; the condition builder takes an optional `vocabulary` (fields/operators) so the host's field list differs from the OpenHop API's. `HostRepeaterStatsPane` polls `GET .../stats` every 5 s while shadow mode is on. The host vocabulary adds `channel_name`, `region`, `path_first`, `path_last`, `path_string`, the `matches` operator and `ruleGates: true`, which makes `OpenHopRuleForm` show the match-probability / throttle / throttle-budget inputs (stored as `then.prob`, `then.throttle_seconds`, `then.throttle_key`; blank inputs are omitted from `then`). The OpenHop API section passes no `ruleGates`, so its form is unchanged. `OpenHopPolicyRules` takes optional `ruleStats` (`policy_matches`, `policy_passes`, `saved_airtime_by_rule` from the stats poll) and renders hits / passes / saved airtime plus `prob` / `throttle` badges per rule. `FIELD_SPECS` in `OpenHopConditionBuilder.tsx` gives each known field a value type, its operators (filtered against the vocabulary) and an optional value picker (`route_type`, `payload_type`, `path_hash_size`, `mode`, booleans). The per-field operators mirror OpenHop's own editor: `greater_or_equal` / `less_or_equal` only on `payload_length`, `hop_count`, `rssi` and `snr` (`RANGE_OPS`); the other numeric fields get `NUMBER_OPS` (no `>=` / `<=`); `channel_hash` gets `equals` / `not_equals` / `in`; the text fields (`channel_message_body`, `channel_sender`, `payload_hex`) get `TEXT_OPS` (no `in`; `matches` only reaches the host vocabulary). Operators are listed in the field's own order (`operatorsFor`), which is OpenHop's: text fields start with `contains`, and the first operator is what a row falls back to when its field changes. A stored operator the field does not offer stays selectable (`withCurrent`). Values are stored as JSON numbers / booleans for numeric and boolean fields because OpenHop's `PolicyEngine._compare` uses plain `==` (no coercion); group refs (`@...`) and unparseable input stay strings. The default (OpenHop API) field list mirrors OpenHop `repeater/engine.py` `policy_context` plus `policy_engine.py` `_get_field_value`. The rule form owns Match all / Match any (next to Action, OpenHop's own layout) and edits `if` as a `ConditionGroup` (`toConditionGroup` / `fromConditionGroup`); `OpenHopConditionList` renders the flat rows (remove / reorder; order matters, `all` short-circuits, so cheap fields before `channel_message_body`). `fromConditionGroup` drops empty rows and stores `{}` instead of `all: []` (OpenHop: `all([])` is true, so it would match every packet). OpenHop's `_rule_matches` only evaluates one level; a nested group reaches `_condition_matches` as `None == None` and always matches, so the editor never creates nested groups and shows a warning on legacy ones for the OpenHop API vocabulary.
- Phase 4: Timing also edits `rx_delay_base` and `use_score_for_tx`; an own **Advert limiter** block edits the per-node token bucket (`advert_*`). `HostRepeaterStatsPane` renders the receive-hold percentiles (`rx_delay`), the advert limiter counters and a **Lifetime totals** block; its `onReset(lifetime)` maps to `api.resetHostRepeaterStats(lifetime)` (`POST .../stats/reset?lifetime=true`). The stats fields are optional in `HostRepeaterStats` so older fixtures stay valid.
- DMC filter sync: `HostRepeaterFilterExtras` (inside the DMC filter block) edits `filter_dryrun`, `filter_advert_hours`, `filter_age_minutes`, `filter_paths` (Block button, hex 1-4 bytes), sender / text rules (`RuleList`: pattern, seconds, share %) and the `filter_watch` list, with per-prefix / per-rule counters from `stats.filter`. A **Neighbour poll** block edits `neighbor_poll_enabled` (transmits; label says so) and `neighbor_poll_interval_hours`. `HostRepeaterStatsPane` adds `FilterDetail` (totals, saved airtime, malformed reasons, top sources, advert cache) and `NeighbourDetail` (poll summary + neighbours table); `dryrun:<reason>` stats keys render as "Dry-run: <reason label>".
- Fanout (`SettingsFanoutSection` `CommunityTopicControls`): `publish_filter` + `filter_interval_ms` (seconds in the UI, 60-600) and `publish_own_neighbors`, all default off.

### Spam Guard

- Tools page `SpamGuardView` (conversation type `spam-guard`, hash `#spam-guard`, sidebar tool key `spam-guard`). The sidebar row and its Customize entry only exist while `appSettings.spam_guard_enabled` is on (`Sidebar` prop `spamGuardEnabled`).
- `useSpamGuard` holds the page state: `GET /spam-guard`, refetched (debounced) on the WS `spam_guard` event via `utils/spamGuardEvents.ts` and on a 30 s poll; `action(op, args, messageId)` and `save(settings)` (versioned, reloads on 409).
- Tabs live in `components/spamGuard/`: `SpamOverviewTab` (mode, pause, sensitivity, health including the OpenHop rule sync state `health.sync_state`, last check and repair count, totals, CSS bar charts; hour of day arrives in UTC and is shifted to local time), `SpamProtectionTab` (lockdown, held messages, blocks; routine duplicate-suppression blocks stay hidden behind a checkbox), `SpamMessagesTab`, `SpamSourcesTab` (candidates are repeater contacts whose key starts with the route code; `SpamSourcesMap` is lazy-loaded), `SpamSettingsTab` (draft of the settings document, a tunable equal to its preset or default value is not stored as an override; on an OpenHop backend a protected private channel gets an "Also enforce on the OpenHop node" checkbox that sets `share_key` after a `window.confirm`, because that copies the channel key to the node. Private is `state.private_channels` for a saved channel and a guess from the channel list for one being added). `spamGuardTunables.ts` lists every tunable; its strings are `spam_set_<key>_label` / `_help` / `_risk`. `spamGuardText.ts` words block reasons and activity entries from the backend's codes.
- Chat: `MessageList` props `spamGuardEnabled`, `hideSpam`, `onHideSpamChange`, `onSpamFeedback`. With the feature off nothing is hidden or marked, whatever `hide_spam` says. `MessageRowActions` gets `onMarkSpam` / `onNotSpam`. `useRealtimeAppState` treats a hidden spam message like a muted one and applies the WS `message_spam` event (`useConversationMessages.receiveMessageSpam`).
- Settings: master switch and Hide spam in `SettingsLocalSection`; `SpamGuardStatusLine` in the host repeater and OpenHop settings.

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
- Optional second argument `events` (`'chat'`) appends `?events=chat` to the URL; the backend then leaves out `raw_packet` and `host_repeater` for that connection (chat popup).
- Heartbeat ping every 30s.
- Incoming JSON is parsed through `wsEvents.ts`, which validates the top-level envelope and known event type strings, then casts payloads at the handler boundary. It does not schema-validate per-event payload shapes.
- Event handlers: `health`, `message`, `contact`, `contact_resolved`, `channel`, `raw_packet`, `message_acked`, `message_deleted`, `contact_deleted`, `channel_deleted`, `error`, `success`, `pong` (ignored).
- Event handlers: `health`, `message`, `contact`, `contact_resolved`, `channel`, `raw_packet`, `message_acked`, `message_failed`, `message_deleted`, `contact_deleted`, `channel_deleted`, `error`, `success`, `pong` (ignored).
- Event handlers: `health`, `message`, `contact`, `contact_resolved`, `channel`, `raw_packet`, `message_acked`, `new_node`, `contact_deleted`, `channel_deleted`, `error`, `success`, `pong` (ignored).
- `host_repeater` is not routed through a handler prop: `useWebSocket` re-emits it as a window event (`utils/hostRepeaterEvents.ts`), which `hooks/useHostRepeater.ts` subscribes to while Settings > Host repeater is mounted.
- Armed mode (plan 29 Phase 3): `HostRepeaterSettings` shows the arm panel only while `env_enabled`; **Arm live repeating...** is disabled with the blocker list (or while `dirty`), opens an inline confirmation with an "I understand" checkbox, then calls `api.setHostRepeaterMode('armed', true)` (`useHostRepeater.setMode`; a 409 carries `blockers` in `ApiError.detail`). While armed a red banner with **Disarm (kill switch)** (`api.disarmHostRepeater`) replaces it; `disarm_reason` / `rearm_pending` are shown after an automatic disarm. `useHostRepeater` applies the live fields of a WS event over local edits so the armed state is never stale. `StatusBar` shows a **Repeating** badge from `hooks/useHostRepeaterArmed.ts` (initial GET + the WS event). `HostRepeaterStatsPane` renders `stats.tx` (sent, errors, queue, drops).
- For `raw_packet` events, use `observation_id` as event identity; `id` is a storage reference and may repeat.
- `raw_packet` carries `relay_reception` / `last_hop_hex` for flood copies stored for Mesh Health "Relay reception". `MeshRelayReceptionPanel` listens through `subscribeRawPackets` (store listener, no render per packet) and re-fetches on short (30m/1h) windows at most every 3 s, with a 30 s poll as fallback.

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
- `#manual` - User Guide (`ManualView`); conversation type `manual`
- `#knowledge-base` - Knowledge base (`KnowledgeBaseView`); conversation type `knowledge-base`
- `#channel-registry` never carries an edit target: the channel header / info panel shortcut navigates with `Conversation.registryEditKey`, which `ChannelRegistryView` (`editChannelKey`) uses once to open that channel's edit modal (seeding the entry if missing)

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

Note: MQTT, bot (since removed), and community MQTT settings were migrated to the `fanout_configs` table (managed via `/api/fanout`). They are no longer part of `AppSettings`.

`HealthStatus` includes `fanout_statuses: Record<string, FanoutStatusEntry>` mapping config IDs to `{name, type, status}`.

`FanoutConfig` represents a single fanout integration: `{id, type, name, enabled, config, scope, sort_order, created_at}`.

`RawPacket.decrypted_info` includes `channel_key` and `contact_key` for MQTT topic routing.

`UnreadCounts` includes `counts`, `mentions`, `last_message_times`, `last_read_ats`, and `first_unread_ids`.

The unread divider is anchored to `first_unread_ids` - the id of the oldest unread message per conversation - not to a timestamp. `MessageList` locates it with `findIndex(msg.id === unreadMarkerMessageId)`, which returns `-1` when that message is not in the loaded window; that is the signal to offer "Jump to unread" (routed through the `targetMessageId`/`getMessagesAround` path) rather than render a divider. Locating by timestamp instead would return index 0 whenever the boundary sits further back than the loaded window, silently placing the divider on the wrong message.

Counts are incremented live over WebSocket while `first_unread_ids` only arrives with a full `/read-state/unreads` fetch, so `useUnreadCounts.incrementUnread` seeds the boundary itself on the read→unread transition. A channel going unread while the app is open would otherwise have a count but no boundary, and no divider at all.

**Mark unread from here**: a message-row action (`MessageRowActions`, envelope icon, incoming messages only) calls `useUnreadCounts.markConversationUnreadFromMessage`, which hits `api.markContactUnread`/`api.markChannelUnread` (`POST .../mark-unread {message_id}`) and then resyncs via `refreshUnreads`. Decision: read state stays server-side and shared across browsers, consistent with mark-read. Because the app auto-re-marks the active conversation as read on every `/unreads` refresh (WS reconnect, mute toggle, `channelsLen`/`contactsLen` change - see `fetchUnreads`), marking the *currently open* conversation unread would otherwise be wiped out on the very next such refresh. `useUnreadCounts` suppresses that auto re-mark for the conversation just marked unread (`suppressAutoReadKeyRef`) until the user genuinely navigates away and back to it (`prevActiveKeyRef` distinguishes a real navigation from an incidental re-render with a new `activeConversation` object for the same conversation) - at that point it is treated as read again, like any other conversation. There is no sidebar-level "mark unread" (no context-menu pattern exists in `Sidebar.tsx` to hang it off); only the per-message row action exists.

## Contact Info Pane

`ContactInfoBody`'s Network region also lists **Positions** (`ContactPositionsSection`, plan 14): the advertised positions from `GET /api/contacts/{key}/location-history` (`api.contactLocationHistory`, rounded to 4 decimals server-side), newest first, formatted with the coordinate-format preference and first/last seen; hidden until at least one is stored (`data-testid="contact-positions"`).

**SNMP agent card** (`components/settings/SnmpAgentSettings.tsx`, rendered by `SettingsRadioAppSection` after the TEAM beacon card): self-contained, it loads and saves through `api.getSnmpAgent` / `api.saveSnmpAgent` (`/api/snmp-agent`) instead of `AppSettings`, and shows the listener state (running with request counters, the bind error, or off). Save is disabled until something changed.

`ContactInfoBody`'s Data region shows the **SNMP (LAN)** card for repeaters and room servers (`ContactSnmpSection` in `components/snmp/ContactSnmpSection.tsx`, field table and formatters in `components/snmp/snmpFields.ts`, which mirrors `app/snmp/mib.py`). It reads `api.getSnmpConfig`, saves with `api.saveSnmpConfig` (empty community = `null` = keep the stored one; the community is never returned by the API), polls with `api.pollSnmp` and shows the 22 values grouped. The form also sets scheduled polling (`poll_enabled`, `poll_interval_minutes`). `SnmpHistoryChart` (`components/snmp/SnmpHistoryChart.tsx`) charts stored polls from `api.snmpHistory` with a value picker and a 24 h / 7 d / 30 d range, using `ZoomableChart`; the section bumps its `version` prop after each poll to reload it. It sits outside the repeater login gate because polling is LAN only. "Ask node for its address" (`api.discoverSnmpAddress`) is the only action that transmits (one CLI command over RF), so it takes a second click; it only fills the host field.

**SNMP page** (`components/SnmpView.tsx`, Tools > SNMP, `#snmp`, lazy-loaded by `ConversationPane`): reads `api.snmpNodes` (`GET /api/snmp/nodes`, stored data only) into one table row per node. Columns sort through `sortSnmpNodes` (no value = last in both directions); the default order is status, so failing nodes (`snmpNodeStatus`: `last_error` set) come first and get a red row. The value columns are `OVERVIEW_VALUE_KEYS` looked up in `SNMP_FIELDS`, so labels and formatting come from `snmpFields.ts`. The arrow in a row, or a click on the row, calls `onOpenNode` (the buttons in the row stop the click), which opens the node page below. "Poll now" and "Poll all now" (one node after the other, in the shown order) call `api.pollSnmp` and patch the row from the response. Auto refresh (0 / 10 / 30 / 60 s, localStorage `rtfm-snmp-refresh-seconds`, default 30) only re-reads the list and skips a tick while a poll is in flight. The page must never call `api.discoverSnmpAddress`: that transmits over RF. The node name calls `onOpenContactInfo`. Wiring a Tools page touches `types.ts` (`ConversationType`), `utils/urlHash.ts`, `hooks/useConversationRouter.ts`, `utils/sidebarLayout.ts`, `Sidebar.tsx`, `ConversationPane.tsx` and `buddy/buddyLogic.ts`. Nothing is needed in the message loader: `isMessageConversation` (`hooks/useConversationMessages.ts`) is an allow list (`MESSAGE_CONVERSATION_TYPES`: `contact`, `channel` and `contact-info`, the last so a contact's messages are ready when its chat is opened from the contact page), so a new page type loads no messages. The loader treats a change between a chat and a non-chat page as a conversation switch even when the id is the same, because a page can share its id with a chat (the SNMP page of a node and that contact).

**SNMP node page** (`components/SnmpNodeView.tsx`, `#snmp/<public key>`, its own lazy chunk): the conversation is `{type: 'snmp', id}` where id `'snmp'` is the overview and any other id is a node's public key (`parseHashConversation` / `getConversationHash`; the sidebar entry is current for both). `ConversationPane` keys the view by that id. It finds its node in `api.snmpNodes` and loads `api.snmpHistoryRange(publicKey, start, end?)` for the selected window (`TimeRangeSelector`, stored under `rtfm-snmp-node-window`, default 24h; presets send only `start`, Custom sends both and loads nothing until Apply). The charts are data: `CHARTS` lists id, group, kind (`gauge`, `counter`, `airtime`) and field keys, and `buildChart` turns the history into series. `components/snmp/snmpSeries.ts` holds the maths: `toChartPoints` (gauges), `ratePoints` (a counter's increase between two polls per `scale` seconds; an interval with a lower uptime or a lower counter gives no point) and `countReboots`. The Rates / Totals switch (`rtfm-snmp-node-counters`) only affects counter and airtime charts. `SnmpSeriesChart` is the shared Recharts chart (one series = filled area, several = lines, inside `ZoomableChart`); `SnmpHistoryChart` on the contact card uses it too. `components/snmp/snmpNode.tsx` has what both SNMP views share (`snmpNodeStatus`, `SnmpStatusBadge`, `applySnmpPoll`, `snmpNodeName`) and `SnmpRefreshSelect.tsx` the shared auto refresh setting. Like the overview, this page must never call `api.discoverSnmpAddress`.

`ContactInfoBody`'s Network region lists **Message routes (scored)** from `analytics.path_scores` (`ContactPathScore` in `types.ts`, from `GET /contacts/analytics`): hops via `parsePathHops`, `Flood` for `path_len` -1, `(direct)` for an empty path, then `contact_path_score_detail` (score as a percentage, delivered/attempts, last trip time) and the last-used time. Rows carry `data-testid="contact-path-score"`. Display only; the backend does the scoring (plan 28 item 1.15).

`ContactInfoBody`'s Network region shows **Suggested routes** for companions (`ContactRouteSuggestionsSection` in `components/ContactRouteSuggestions.tsx`, contact type 1 with a full key) from `GET /api/contacts/{key}/route-suggestions` (`api.contactRouteSuggestions`, `ContactRouteSuggestions` in `types.ts`). Each row has a **Use** button that calls `api.setContactRoutingOverride(key, suggestion.route)`; nothing is applied otherwise. **Check with analyzer** refetches with `validate=true` and shows the verdict per route; the hint names the analyzer host because that request sends the contact key and hop IDs to it. The section is hidden when there are no suggestions.

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

The Beacons overlay (`map/useTeamBeacons.ts` + `map/layers/teamBeaconsLayer.ts`) follows the same shape for MeshCore TEAM traffic: it fetches `GET /messages/beacons` for the map window while its toggle is on (`remoteterm-map-beacons`, plus `-trails` to fetch every beacon and draw per-sender tracks), and `MapView` calls its `attach`/`reattach` next to the shared-locations ones. Popup DOM helpers shared by both overlays live in `map/locationPopup.ts`. Chat cards for the same payloads are rendered by `TeamPayloadMessage` in `MessageList.tsx` from `utils/teamPayloads.ts` (parser, mirror of `app/team_payloads.py`) and `utils/teamPayloadText.ts` (translated status phrases, also used by the popups and by `ContactBeaconHistorySection` in `ContactInfoBody.tsx`). A new map section id needs an entry in the `GROUPS` list in `map/controls/MapControls.tsx` or it is not shown. TEAM cards do not depend on the rich-payload preference (`renderTeamPayload` runs before it). Sending: `LocationPickerModal` offers the TEAM waypoint and TEAM beacon formats when `teamFormatsAllowed` (private channel, not Public, not hashtag), and the Share location menu in `ChatHeader` adds "Beacon: my radio location" / "Beacon: my current GPS" entries under the same condition. All of them call `onInsertLocation(lat, lon, label, format?)` with a `TeamLocationFormat` (`{ teamWaypointType }` or `{ teamBeacon: true }`), and `handleInsertLocation` in `hooks/useConversationActions.ts` then appends `buildTeamWaypointPayload()` or `buildTeamTelemetryPayload()` (mirror of the backend `encode_telemetry`, radio battery from `health.radio_stats.battery_mv`) to the composer. Nothing is sent until the user presses Send; the periodic `#TEL:` beacon is configured in `components/settings/TeamBeaconSettings.tsx` (mounted in `SettingsRadioAppSection`). A contact's `vessel_type` (select in `ContactAnnotations`) overrides the beacon icon via `teamBeaconIcon(beacon, vesselType)`.

GPX export (Export FAB, `fabs.gpxExport` / `onExportGpx` in `map/controls/MapControls.tsx`, a direct-action button in the no-panel `toggles` list, not a toggle: its `active` is left `undefined` so no `aria-pressed` is rendered): `MapView`'s `handleExportGpx` re-derives the raw (pre-effective-location) contact objects behind `mappableContacts` via `contactByKey`, so the pure `utils/gpxExport.ts` (`buildNodesGpx`) can tell an advertised location from a manual-fallback one (noted in the waypoint `<desc>`) from the original `lat`/`lon`/`manual_lat`/`manual_lon` fields. It best-effort calls `api.bulkContactUris` (`POST /contacts/bulk-contact-uris`) for a `meshcore://` link per node from stored raw adverts (never the radio); a lookup failure still downloads the GPX, just without links. Downloads `rtfm-ev-nodes-<date>.gpx` (waypoints only, no tracks; a node with no usable location is skipped).
The relay-signal overlay (plan 21 S2; `map/useRelaySignal.ts` + `map/layers/relaySignalLayer.ts`) fetches `GET /packets/relay-reception` (`api.getRelayReception`, `limit=1`: only the per-relay summary is used) for the map window while its FAB toggle is on (`remoteterm-map-relay-signal`), re-fetching every 60 s for open-ended windows. `buildRelaySignalFeatures` places a summary row at its `resolved_pubkey` contact from `mappableContacts` (manual locations and the map filters applied), colours it with `snrColor` from `map/packets/packetAnimMath.ts` and sizes it by `relayRingRadius(receptions)`; unresolved, colliding or unlocated relays are counted as `unplaced`, the direct (no relay) row is skipped. The ring layer is inserted below `rt-nodes` and has no click handler, so node popups are unchanged. The section id `relay-signal` is listed in the Overlays group in `map/controls/MapControls.tsx` (a section missing from a group's `memberIds` is not rendered).

The guessed-locations overlay (pure logic in `map/guessedLocations.ts`, layer in `map/layers/guessedLocationsLayer.ts`, wired by `map/useGuessedLocations.ts`) estimates a position for a contact with no effective location: it fetches `GET /contacts/repeaters/advert-paths` (despite the name, this returns paths for all contacts) while its FAB toggle is on (`remoteterm-map-guessed-locations`), then for every unlocated contact heard in the last 24h, resolves each known path's `next_hop` (the hop nearest the origin — RTFM-EV stores `path_hex` as `origin -> ... -> self`, the opposite array convention from meshcore-open's own reversed `Contact.path`) against a same-render index of located repeaters, using only 2-/3-byte hops (1-byte hops collide too often). Anchors farther apart than `2 * ESTIMATED_LORA_RANGE_KM` (a fixed 15 km estimate, not a live radio read, so the layer still works with no radio connected) are dropped as mutually inconsistent; the guess is placed 330 m off a single anchor or 80-120 m off a weighted centre of several (biased toward the freshest anchor, normalized by the true weight sum — see the module doc for the divide-by-anchor-count bug this fixes relative to meshcore-open), at an angle seeded from the contact's public key so it is stable across renders. Guesses are drawn as a hollow "~" marker (never a filled circle, so they cannot be mistaken for a real position), shown at every zoom level with a name/ID-tag label that follows the map's node-label mode and `LABEL_MIN_ZOOM` (layer placed below `rt-node-labels` so real node labels win collisions), and are never persisted, exported or sent anywhere.
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

**Settings Editor pane** (`RepeaterSettingsEditorPane.tsx`, defs in `repeaterSettingsDefs.ts`): editable rows for the allow-listed settings, seeded from the Radio Settings / Advert Intervals / Node Info / Owner Info pane data, plus a "Read current values" button (`api.repeaterSettingsRead`, `get` only, not part of Load All). Every change goes edit -> confirm (setting, current value, new value, exact CLI command) -> `api.repeaterSettingSet` (one `set` + `get` read-back) -> result (ok / mismatch / rejected / unverified). Radio f/bw/sf/cr is one `set radio` behind a strong confirm (type the repeater name; stranding + reboot warning). The `observer` group (`SETTING_GROUPS` entry with `separateRead`, currently only `snmp` on/off) has its own Read button that calls `api.repeaterSettingsRead` with just its keys, is not covered by "Read current values", and keeps its rows locked until the repeater reported a real value, so a stock repeater is never sent the key. The client validators mirror `app/services/repeater_settings.py`, which stays the authority. After a verified read-back the hook's `applySetting` patches the matching read-only pane data (`applyReadbackToPaneData`).

**Actions pane**: Send Advert, Sync Clock, Reboot - all send CLI commands via `POST /api/contacts/{key}/command`.

**Console pane**: Full CLI access via the same command endpoint. History is ephemeral (not persisted to DB).

**History pane** (`RepeaterConfigHistoryPane.tsx`, plan 14): read-only list of the stored pane snapshots from `GET /api/contacts/{key}/repeater/config-history` (`api.repeaterConfigHistory`), grouped by kind in pane order (Node Info, Radio Settings, Advert Intervals, Owner Info, Regions), newest first, each diffed against the previous snapshot of that kind (`utils/deviceConfigHistory.ts`: `buildConfigHistory`, `formatConfigValue`); five per kind, then "Show all". `RepeaterDashboardBody` passes a `reloadKey` built from those panes' `fetched_at`, so it re-reads (DB only, no radio) after a pane fetch. `RoomServerPanel` reuses it full width under the room tools with `loadHistory={api.roomConfigHistory}` (`GET /api/contacts/{key}/room/config-history`, ACL snapshots), `noteKey="room_config_history_note"` and the ACL pane's `fetched_at` as `reloadKey`.

All state is managed by `useRepeaterDashboard` hook. State resets on conversation change.

## Room Server Panel

For room contacts (`type=3`) on **mobile**, `ConversationPane.tsx` keeps the normal chat surface but inserts `RoomServerPanel` above it. There it is mounted with `autoLogin`: when `useRememberedServerPassword` has a stored password (`storedPassword`), one room login is sent on mount (guarded by a ref: at most once per mount, never retried after a failure, because every login is RF traffic). Once authenticated the panel shows **Sync Now**, which re-issues the login so the room server resends recent messages. The desktop `ContactInfoView` embed does not pass `autoLogin`. That panel handles room-server login/status messaging and gates room chat behind the room-authenticated state when required. On **desktop**, the room lands on the full-page `ContactInfoView` with `RoomServerPanel` embedded in the minimizable login region (see "Desktop full-page view vs. mobile Sheet").

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

**Tailwind 4 layout of the stylesheets.** `index.css` holds `@import 'tailwindcss'`, the `@theme` tokens and a set of rules that keep Tailwind 3 behaviour, each commented in place: the universal reset in `@layer base` (after the utilities it would cancel `space-*`, which has zero specificity in Tailwind 4), `space-x-*`/`space-y-*` restored to start-margin at class specificity, `hover:` on plain `:hover`, `cursor: pointer` on buttons, absolute line-heights for the text sizes, and Tailwind 3's sRGB values for the default-palette shades in use (add a shade to that list when a new one is used). `main.tsx` imports `index.css` and then `app-layers.css`, which pulls `themes.css`, `styles.css` and `popout/popout.css` into the `utilities` cascade layer; do not import those three directly, because unlayered CSS beats every Tailwind utility regardless of specificity. `tailwindcss-animate` is loaded with `@plugin`. When adding a string that looks like a utility name but is not a class (`'shadow'`, `'outline'`, `'blur'`, `'ring'`), remember that Tailwind's upgrade tooling rewrites such words.
Do not rely on old class-only layout assumptions.

### Theme-driven layout (Atlas shell)

A theme can ask for another app shell with `layout` on its `THEMES` entry (`utils/theme.ts`). Only `'atlas'` exists, set on `mceu-light` and `mceu-dark`; every other theme is `'classic'`. Read it with `useThemeLayout()` (or `getThemeLayout()` outside React), never by matching theme ids.

`AppShell` is the only place that branches on it: `atlasShell` on desktop (`layout === 'atlas' && !useIsMobile()`) and `atlasPhone` on phones.

Desktop:

- The sidebar gets `shellHead` / `shellFoot` render props (`components/shell/AtlasSidebar.tsx`): brand plus a "Search anything" button that opens the command palette (`utils/commandPalette.ts` `openCommandPalette()`), and rows for Settings / Back to Chat, chat window, language and theme. Both take `rail` for the collapsed sidebar. The settings nav in `AppShell` renders the same head and foot.
- `StatusBar variant="topbar"` renders inside `<main>` and shows radio state only (sparkline, status pill, battery, node name, reconnect).
- `<main>` itself is never moved or wrapped, so switching theme or crossing the breakpoint does not remount the conversation pane. Keep it that way.
- The theme dialog's open state lives in `AppShell` (`ThemeSettingsDialog`), because picking a theme with another layout unmounts whichever control opened it.

Phones:

- `StatusBar variant="phonebar"` keeps the brand and radio state and drops the menu button and the app controls.
- `components/shell/AtlasTabBar.tsx` sits at the bottom: Chats, Map, My Node, More. Chats and More open the existing left drawer with `Sidebar sectionFilter="chats"` or `"tools"`; the More half ends in `AtlasSidebarFoot`. Map and My Node select their page.
- The drawer always renders the conversation sidebar there, also while settings are open.

Chat rows: `AppShell` wraps `ConversationPane` in `MessageLayoutProvider value="cards"` under the Atlas layout (desktop and phone). `MessageList` then renders each message as a full-width card with its own header and a chip row (`HopCountBadge variant="chip"`, the scope badges, the delivery mark). The pieces of a row (`body`, `renderMeta`, `outgoingStatus`, `preview`, `rowActions`) are shared by all three layouts; a layout only decides where they go. The chat popup has its own provider and never gets cards.

Page heads and panels are CSS only (`themes.css`, the two "MCEU: page head" and "MCEU: panels are cards" blocks). They match what pages already have: a `border-b border-border px-4` bar holding an `h2.text-base.font-semibold` title (or that h2 being the bar), and bordered rounded boxes inside `<main>` without a background utility or with `bg-background`. A new page gets the look by following that pattern; a page that names its title or tiles differently does not, and nothing fails when that happens.

`selectLeavingSettings` in `AppShell` (the tab bar, the phone drawer and the desktop buddy use it) waits for the history step that closing settings triggers before it selects: the conversation router re-selects the entry that step lands on, and an immediate select loses to it.

Not observable in jsdom: the real column layout, the upward language menu, the rail, the drawer and the history race above. Check those in a browser.

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

Waits in tests (`waitFor`, `findBy*`) get 5 s, set once in `src/test/setup.ts`
(Testing Library's own default is 1 s); a whole test gets 20 s
(`vitest.config.ts`). Both are headroom for load: the suite runs one worker per
CPU thread, and a wait on an asynchronous render that settles in a few hundred
ms alone has been measured past 1 s inside a full run. Do not lower either to
make a failing test report sooner, and prefer waiting for the thing you assert
(`findByTestId`, a specific `waitFor`) over a fixed delay.

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

### User Guide content

The in-app User Guide (`#manual`, sidebar Tools > User Guide) is plain markdown
per locale in `src/content/manual/{en,nl,de}.md`, imported with Vite `?raw` and
parsed by `utils/manualMarkdown.ts` (a small subset: `<!-- id: x -->` section
markers, `##`/`###`, paragraphs, `-`/`1.` lists, bold, italic, code, http(s)
links). It renders to React elements, never HTML strings. When user-facing
behavior changes, update all three files. Keep the same ordered `id` markers in
each and no em dashes: `src/test/manualContent.test.ts` enforces both. Use the
UI label text from the matching locale catalog so the guide matches the screen.
The same files are also published to the GitHub Pages docs site as
`/guide/<lang>/` (`scripts/build/stage_pages_site.py`, `.github/workflows/pages.yml`),
with the `id` markers as section anchors; keep them stable, since site links
and the language switch depend on them.

Translation strings for NL/DE are adapted in part from kiekr-i18n by Marcel
Verdult (@marcelverdult), https://github.com/marcelverdult/kiekr-i18n, CC-BY 4.0.

### Triangulation link-out (plan [13])

`utils/triangulatorLink.ts` builds `https://triangulator.dutchmeshcore.nl/?prefixes=<first 6 hex>` for a node (the DMC triangulator's own deep-link form: 2/4/6-hex path-hash prefixes, optional `:count` weights, `prefixes2`, `hop2`, `cluster`; it auto-runs discovery from the public mc-radar / map.meshcore.io feeds). Shown as "Triangulate on triangulator.dutchmeshcore.nl" in the contact info identity section (`ContactInfoBody`, independent of configured analyzer sites) and as a "Triangulate" link in the map node popup (`MapView.buildContactPopup`). It is a link-out, not an embedded estimator: the plan rejected a from-scratch port as a separate large plan.
