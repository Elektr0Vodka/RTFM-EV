# In-app update-available indicator

Date: 2026-09-11
Status: Approved design, pending implementation plan

## Goal

Tell the user, inside the app, when a newer version of the fork exists, and give them
a button that opens the changes on GitHub. Detect-and-notify only. No self-update,
no one-click trigger, no container restart.

## Scope decisions (agreed)

- Comparison basis: running commit vs fork `main` HEAD commit. Not tags, not GitHub
  Releases (the fork publishes neither Releases nor a stable "latest release" object).
- Repository checked: `Elektr0Vodka/RTFM-EV` (the fork / `origin`), not `upstream`.
- The indicator includes a real button that opens the `main` compare view in a new tab.
- Out of scope: self-updating the container, Watchtower/host-socket orchestration,
  Home Assistant supervisor hand-off, tag/Release-based checks.

## Backend

### New router: `app/routers/update_status.py`

Registered in `app/main.py` with `app.include_router(update_status.router, prefix="/api")`
alongside the existing routers.

Endpoint: `GET /api/update-status`

Behaviour:

1. If `settings.update_check_enabled` is `False`, return immediately with
   `check_enabled: false` and `update_available: false`. No outbound call.
2. Resolve the local commit from `get_app_build_info().commit_hash`
   (already resolved from git, then `COMMIT_HASH`/`VITE_COMMIT_HASH` env, then
   `build_info.json`). If `None`, return `update_available: false` with the result
   marked unknown. No outbound call.
3. If a cached result exists and is younger than the TTL, return it.
4. Otherwise call GitHub once:
   `GET https://api.github.com/repos/Elektr0Vodka/RTFM-EV/compare/<local_commit>...main`
   using the existing `httpx` dependency, unauthenticated (no token). The `compare`
   response yields both `status` and `ahead_by` in a single request.
5. Interpret:
   - `ahead_by > 0` (that is, `main` is ahead of local) → `update_available: true`,
     `commits_behind = ahead_by`.
   - `ahead_by == 0` or `status == "identical"` → up to date.
   - `status == "diverged"`, HTTP 404 (local commit not on `main`), or any network/
     GitHub error → `update_available: false`; cache a short-lived empty result so a
     transient failure does not hammer the API.
6. Cache the interpreted result in-memory with a TTL of 6 hours. Stays well under
   GitHub's unauthenticated 60 req/hr per-IP limit.

Response shape:

```json
{
  "check_enabled": true,
  "update_available": true,
  "current_commit": "dc11fbe",
  "latest_commit": "a1b2c3d",
  "commits_behind": 7,
  "compare_url": "https://github.com/Elektr0Vodka/RTFM-EV/compare/dc11fbe...main",
  "checked_at": 1757600000
}
```

- `current_commit`: local short commit, or `null` if unknown.
- `latest_commit`: `main` HEAD short commit from the compare response, or `null`.
- `commits_behind`: integer, `0` when up to date or unknown.
- `compare_url`: constructed as
  `https://github.com/Elektr0Vodka/RTFM-EV/compare/<current_commit>...main`.
  Present whenever `update_available` is `true`.
- `checked_at`: unix seconds of the last successful/attempted check.

The endpoint never raises to the client. Any failure degrades to
`update_available: false`.

### Config

New field on `Settings` in `app/config.py`, following the existing
`env_prefix="MESHCORE_"` pattern:

```python
update_check_enabled: bool = True  # env: MESHCORE_UPDATE_CHECK_ENABLED
```

Default `true` (opt-out). Documented in `docker-compose.example.yml` as a commented
`MESHCORE_UPDATE_CHECK_ENABLED: "false"` option for air-gapped / privacy-conscious
deployments.

## Frontend

- A `useUpdateStatus` hook (or a single fetch) calls `/api/update-status` once on app
  load and caches for the browser session.
- Primary surface: Settings -> About (`SettingsAboutSection.tsx`), a line directly
  under the version showing "Update available - N commits behind" and a button
  "View changes" (a real button element) that opens `compare_url` in a new tab
  (`target="_blank" rel="noopener noreferrer"`).
- Secondary cue: a small dot/badge on the Settings gear icon when
  `update_available` is `true`, so the update is noticed without opening the panel.
- When `update_available` is `false` or the result is unknown, nothing renders.
- All new user-facing strings use `t()` with matching EN/NL/DE keys (enforced by the
  i18n eslint rule and the translation-parity test).

## Testing

Backend:

- Mocked GitHub `compare` responses: `main` ahead (update available), identical
  (up to date), `diverged`, HTTP 404, and network error.
- `commit_hash is None` -> no outbound call, `update_available: false`.
- `update_check_enabled = false` -> no outbound call, `check_enabled: false`.
- Caching: a second call within the TTL makes no HTTP request.

Frontend:

- About section renders the indicator + button when `update_available: true`
  and the button targets `compare_url`.
- About section renders nothing when `update_available: false` / unknown.
- Gear badge shows only when `update_available: true`.

## Non-goals / risks

- The check is an outbound anonymous request to `api.github.com`. Mitigated by the
  opt-out env var and by caching.
- If `COMMIT_HASH` is not baked into the Docker image at build time and git is
  unavailable at runtime, the feature is inert (indicator hidden). This is acceptable
  and must not surface an error.
