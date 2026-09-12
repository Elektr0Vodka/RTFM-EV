# OpenHop Policy Pane - Design Spec

**Status:** Draft for review (2026-09-12)
**Depends on:** OpenHop Surface B foundation (Phases 1-2, branch `feat/openhop-detection`): `is_openhop` detection, `OpenHopClient` (X-API-Key), the gated `/api/openhop` proxy, and the stored `openhop_api_url`/`openhop_api_token` settings.
**Scope:** Phase 3, first pane only - the Network Policy / packet-filter pane, INCLUDING a rule editor. Other panes (Plugins, Config, Update, CAD) are out of scope here.

## Goal

Let an operator of a connected OpenHop node view and edit its packet-filter policy from RTFM-EV: enable/disable the policy engine, set the default action, manage named channel-hash / pubkey groups and their entries, and add/edit/delete individual filter rules. Everything is detection-gated and fail-closed: nothing renders or calls out unless the node is OpenHop AND an API url+token are configured.

## Verified facts (observed 2026-09-12 against the container sim)

- Auth: both `Authorization: Bearer <jwt>` and `X-API-Key: <token>` authorize the policy endpoints. RTFM-EV uses the stored API token (X-API-Key) via `OpenHopClient`, so no admin password is needed.
- `GET /api/policy` returns:
  ```json
  {"success": true, "data": {
    "policy_file": "/etc/openhop_repeater/policy.yaml",
    "exists": false,
    "policy_engine": {"enabled": false, "default_action": "allow", "rules": [],
                      "objects": {"channel_hash_groups": {}, "pubkey_groups": {}}},
    "groups": {"channel_hashes": [], "pubkeys": []}}}
  ```
- `POST /api/policy` updates the policy_engine (accepts root-level fields or a nested `policy_engine` object).
- `POST /api/policy_validate` returns `{success, data: {valid, normalized, effective}}` without saving.
- `GET /api/policy_groups?kind=channel_hashes|pubkeys`, `POST /api/policy_groups {kind, group_id, friendly_name, description}`, `DELETE /api/policy_groups {kind, group_id}`.
- `GET/POST/DELETE /api/policy_group_entries` manage entries within a group.
- Endpoints also present (NOT in this pane's scope, listed for context): `/unscoped_flood_policy`, `/default_region`.

## Rule schema (authoritative, from `openhop_repeater/repeater/policy_engine.py`)

```
policy_engine: {
  enabled: bool,
  default_action: "allow" | "drop" | "log_only",   // SUPPORTED_ACTIONS
  rules: [ Rule ],                                  // evaluated top-down, first match wins
  objects: { channel_hash_groups: {name: value}, pubkey_groups: {name: value} }
}

Rule: {
  id: string|number,          // stable id
  name: string,               // display name
  enabled: bool,              // default true
  if: Condition,              // match; omitted/empty matches nothing
  then: { action: Action } | Action   // (or a top-level rule.action fallback)
}

Condition (one of):
  { field, op, value }                         // single condition (implicit)
  { all: [Condition, ...] }                     // AND
  { any: [Condition, ...] }                     // OR

Action:    "allow" | "drop" | "log_only"
Field:     channel_hash | channel_sender | channel_message_body | channel_decryptable
           | path_hashes | transport_code_0 | transport_code_1 | payload_hex
           | <context key>            // freeform string also allowed
Operator:  equals | not_equals | greater_than | less_than | contains | in | starts_with
Value:     literal, OR "@channel_hash_groups.<name>" / "@pubkey_groups.<name>" reference
```

First matching rule's action wins; if no rule matches, `default_action` applies. `enabled:false` rules are skipped.

## Architecture

Two independent units, both behind the existing fail-closed gate.

### Backend - extend the existing proxy (no new router)

`app/services/openhop_api.py` `OpenHopClient` gains typed methods (thin, one per endpoint):
`update_policy(doc)`, `validate_policy(doc)`, `list_policy_groups(kind=None)`, `create_policy_group(...)`, `delete_policy_group(kind, group_id)`, `list_group_entries(...)`, `add_group_entry(...)`, `delete_group_entry(...)`.

`app/routers/openhop.py` gains matching endpoints under the existing `/api/openhop` prefix, all reusing `_require_client()` (409 when not OpenHop or not configured):
- `POST /policy` (update), `POST /policy/validate`
- `GET/POST/DELETE /policy/groups`, `GET/POST/DELETE /policy/groups/entries`

`GET /policy` already exists. Responses are relayed as-is (the OpenHop `{success, data}` envelope). No new settings, no new migration.

### Frontend - a dedicated "OpenHop" settings section

New `SettingsOpenHopSection.tsx` mounted in the Settings modal's section list, rendered only when `health.radio_device_info.is_openhop` AND `getOpenHopStatus().configured`. It hosts:

1. **Engine card** (`OpenHopPolicyEngineCard`): enable/disable toggle, `default_action` selector (allow/drop/log_only). Save runs `validate` then `update`; validation errors surface inline. Small, static, screenshot-friendly.
2. **Groups manager** (`OpenHopPolicyGroups`): two lists (channel-hash groups, pubkey groups); create/delete group; add/remove entries. Confirm dialog on delete.
3. **Rule editor** (`OpenHopPolicyRules` + `OpenHopRuleForm` + `OpenHopConditionBuilder`): list rules (name, action, enabled, summary of `if`); add/edit/delete/enable/reorder; per-rule a condition builder supporting single or `all`/`any` groups, with field/op/value selects and `@group` references. Edits mutate a local copy of the whole policy doc, then `validate` + `update` (the API replaces the engine config wholesale).

Each unit is a focused component with a narrow prop interface (`policy`, `onChange`, `saving`, `error`) so it can be understood and tested in isolation. State: the section fetches the policy once, holds an editable draft, and saves the whole `policy_engine` via `POST /policy` (validate-first). Types in `types.ts`; api client methods in `api.ts`; i18n keys in EN/NL/DE.

## Data flow

`GET /api/openhop/policy` -> draft in section state. User edits (engine/groups/rules) mutate the draft. Group create/delete/entry ops call their dedicated endpoints immediately and refetch (groups are server-side objects). Engine + rules Save: `POST /policy/validate` -> if `valid`, `POST /policy` -> refetch; if invalid, show `data` errors inline, do not save.

## Error handling

- Not OpenHop / not configured: section does not render (gate). Direct API calls 409.
- Node unreachable / API error: existing 502 mapping in the proxy; the section shows a retry affordance and keeps the last good draft.
- Validation failure: inline, non-destructive (draft preserved).
- Destructive ops (delete rule/group/entry): confirm dialog. No `/api/cli` used here (typed endpoints only), so no destructive-verb guarding needed for this pane.

## Testing

- Backend: `OpenHopClient` methods via httpx MockTransport (verified shapes); router tests assert the gate (409 unconfigured / non-OpenHop) and delegation for each new endpoint. Mirrors existing `tests/test_openhop_api_service.py` / `tests/test_openhop_router.py`.
- Frontend: Vitest - section absent when not OpenHop/not configured; engine toggle + default_action save calls validate-then-update; group create/delete; rule add/edit/delete; condition builder produces the documented `if` shape. i18n parity (EN/NL/DE).
- Runtime (required): against the sim, with screenshots of the static engine/groups/rules views (My Node's live charts time out capture; settings views capture fine). Round-trip a real rule and confirm the sim's `GET /policy` reflects it.

## Out of scope (explicit)

- `/unscoped_flood_policy`, `/default_region` (network-policy siblings, separate pane).
- SSE / live streams (none needed for policy).
- The other Surface B panes (Plugins/Config/Update/CAD).
- Reordering rules by drag-and-drop is optional; a simple up/down control is sufficient for v1.

## Resolved decisions (2026-09-12)

1. **Placement:** a new top-level "OpenHop" settings section (not nested under Radio).
2. **Rule reorder:** up/down buttons in v1 (no drag-and-drop).
3. **Group-entry value formats (probed live):** channel-hash entries are a single byte, accepted as `"0xNN"` and normalized to upper-case (`"0x1f"` -> `"0x1F"`); a multi-byte hex is rejected ("channel hash must be one byte (0x00-0xFF)"). The server validates each entry and returns a clear `{"success": false, "error": ...}`. Client strategy: light client-side hint on format, but rely on the server as the validator and surface its error text; do not hard-block on client guesses. Pubkey entry format is validated the same way server-side; surface server errors.
4. **`/policy_groups` vs. inline `objects` (probed live):** creating a group and adding entries via `/policy_groups` + `/policy_group_entries` DOES populate `policy_engine.objects.{channel_hash_groups,pubkey_groups}` as a derived `{group_id: [values]}` map. So the server-side named groups are the source of truth, and `objects` is the derived view that rule `@channel_hash_groups.<name>` / `@pubkey_groups.<name>` references resolve against. The rule editor's `@`-reference picker lists keys from `policy_engine.objects`; the groups manager drives creation/deletion via the group/entry endpoints and refetches.
