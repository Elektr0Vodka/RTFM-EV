# OpenHop API Token Masking (write-only) Design

**Date:** 2026-09-13
**Branch:** feat/openhop-detection
**Status:** approved (hardening, track C)

## Problem

`GET /api/settings` returns the full `AppSettings`, which includes
`openhop_api_token` in plaintext. Several other endpoints also return
`AppSettings` (PATCH response, blocked-keys/names and muted-channels toggles), so
the secret leaks through all of them. The token is a bearer credential for the
OpenHop node's REST API and should be write-only: settable via PATCH, never
read back.

## Constraints

- Do not break the PATCH-to-save flow or the OpenHop management config UI
  (`frontend/src/components/settings/OpenHopSettings.tsx`).
- Do not corrupt the stored token. Persistence is column-based
  (`AppSettingsRepository.get()` reads explicit columns; `update()` writes
  explicit kwargs), never `model_dump()`, so a model-level serializer mask is
  safe for storage. Verified: every internal read of the token is attribute
  access (`settings.openhop_api_token` in `app/routers/openhop.py`), which a
  `field_serializer` does not affect.
- No em dashes in user-facing strings. New UI strings get t() keys in EN/NL/DE.

## Design

### Backend (`app/models.py`)

- Add a `@field_serializer("openhop_api_token")` to `AppSettings` that always
  returns `None`. This masks the token in every serialized output (GET/PATCH
  responses, toggle responses, any future serialization) while leaving attribute
  access (`settings.openhop_api_token`) and column-based persistence untouched.
- Add a computed field `openhop_api_token_set: bool` = `bool(self.openhop_api_token)`
  so the UI can show whether a token is configured without exposing it.

### Backend PATCH (`app/routers/settings.py`)

- Change token handling so an empty/whitespace value means "keep current":
  set `openhop_api_token` only when `update.openhop_api_token` is not None AND
  non-empty after strip. URL handling is unchanged (empty URL still clears the
  URL, which disables management via the existing status gate that requires both
  URL and token).
- Consequence: the token cannot be cleared by blanking it (write-only). Clearing
  the URL disables management; wiping the stored token is out of scope (YAGNI).

### Frontend (`OpenHopSettings.tsx`)

- The token input is write-only: initialise its state to `''` (do not prefill
  from `appSettings`, which is now `null`). Placeholder tells the user to leave it
  blank to keep the current token.
- On save, include `openhop_api_token` only when the user typed a non-empty value;
  always include `openhop_api_url`. Clear the token input after a successful save.
- Keep the existing server-truth status line (`api.getOpenHopStatus()`); it
  already reports `configured` without the token.
- Add `openhop_api_token_set: boolean` to the frontend `AppSettings` type.

## Testing

- Backend: `AppSettings.model_dump()` masks the token (None) and includes
  `openhop_api_token_set` true/false; the attribute stays real. PATCH with an
  empty token keeps the current token; PATCH with a new token updates it; PATCH
  with only the URL keeps the token. Update the existing
  `test_openhop_api_config_empty_clears` to the new keep-current semantics.
- Frontend: the token field renders empty even when a token is configured; saving
  without typing a token omits `openhop_api_token`; saving with a typed token
  includes it. Update the existing prefill/save tests.
- Confirm the existing settings-router suite and the OpenHop router/proxy tests
  still pass (they read the token by attribute, unaffected).

## Out of scope

- Encrypting the token at rest (separate concern; it stays a DB column).
- Masking other settings fields (none are secrets today).
- A UI affordance to wipe the stored token.
