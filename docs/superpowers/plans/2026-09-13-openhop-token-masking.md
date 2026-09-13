# OpenHop API Token Masking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `openhop_api_token` write-only: never returned by any endpoint that serialises `AppSettings`, still settable via PATCH, UI and internal reads unaffected.

**Architecture:** A `field_serializer` masks the token to `null` on serialisation (attribute access and column-based persistence are untouched). A computed `openhop_api_token_set` boolean tells the UI whether a token exists. PATCH treats an empty token as "keep current". The config UI becomes write-only.

**Tech Stack:** Backend FastAPI + Pydantic v2. Frontend React + TS + i18next + Vitest.

---

## Task 1: Mask the token on the model + expose a set flag

**Files:**
- Modify: `app/models.py` (import + `AppSettings`)
- Test: `tests/test_settings_router.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_settings_router.py`)

```python
class TestOpenHopTokenMasking:
    @pytest.mark.asyncio
    async def test_settings_serialization_masks_token_but_keeps_attribute(self, test_db):
        await update_settings(
            AppSettingsUpdate(openhop_api_url="http://n:8000", openhop_api_token="secret-tok")
        )
        settings = await AppSettingsRepository.get()
        # Attribute stays real for internal use.
        assert settings.openhop_api_token == "secret-tok"
        dumped = settings.model_dump()
        # Serialised output never carries the secret.
        assert dumped["openhop_api_token"] is None
        assert dumped["openhop_api_token_set"] is True
        assert "secret-tok" not in settings.model_dump_json()

    @pytest.mark.asyncio
    async def test_token_set_flag_false_when_unset(self, test_db):
        settings = await AppSettingsRepository.get()
        assert settings.model_dump()["openhop_api_token_set"] is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONPATH=. uv run pytest tests/test_settings_router.py::TestOpenHopTokenMasking -v`
Expected: FAIL (KeyError 'openhop_api_token_set' / token not masked).

- [ ] **Step 3: Implement** in `app/models.py`

Change the import:
```python
from pydantic import BaseModel, Field, computed_field, field_serializer
```

Add to the `AppSettings` class body (after the `openhop_api_token` field definition):
```python
    @field_serializer("openhop_api_token")
    def _mask_openhop_api_token(self, value: str | None) -> None:
        """Write-only: never expose the token in any serialised output."""
        return None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def openhop_api_token_set(self) -> bool:
        """Whether an OpenHop API token is stored (without exposing it)."""
        return bool(self.openhop_api_token)
```

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONPATH=. uv run pytest tests/test_settings_router.py::TestOpenHopTokenMasking -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/models.py tests/test_settings_router.py
git commit -m "feat(openhop): mask api token in settings responses (write-only)"
```

---

## Task 2: PATCH keeps the token when blank

**Files:**
- Modify: `app/routers/settings.py:428-429`
- Test: `tests/test_settings_router.py`

- [ ] **Step 1: Update the existing test + add keep/update tests.**

Replace the existing `test_openhop_api_config_empty_clears` with:
```python
    @pytest.mark.asyncio
    async def test_openhop_empty_token_kept_url_cleared(self, test_db):
        await update_settings(
            AppSettingsUpdate(openhop_api_url="http://x", openhop_api_token="t")
        )
        result = await update_settings(
            AppSettingsUpdate(openhop_api_url="  ", openhop_api_token="")
        )
        # URL still clears; the token is write-only and kept when blank.
        assert result.openhop_api_url == ""
        assert result.openhop_api_token == "t"

    @pytest.mark.asyncio
    async def test_openhop_token_updates_when_nonempty(self, test_db):
        await update_settings(AppSettingsUpdate(openhop_api_token="old"))
        result = await update_settings(AppSettingsUpdate(openhop_api_token="new"))
        assert result.openhop_api_token == "new"

    @pytest.mark.asyncio
    async def test_openhop_token_kept_when_only_url_patched(self, test_db):
        await update_settings(AppSettingsUpdate(openhop_api_token="keepme"))
        result = await update_settings(AppSettingsUpdate(openhop_api_url="http://y"))
        assert result.openhop_api_token == "keepme"
        assert result.openhop_api_url == "http://y"
```

- [ ] **Step 2: Run to verify the new keep test fails**

Run: `PYTHONPATH=. uv run pytest tests/test_settings_router.py::TestOpenHopApiConfig -v` (or whatever class holds these; the empty test previously asserted the token cleared)
Expected: FAIL on `test_openhop_empty_token_kept_url_cleared` (token currently clears to "").

- [ ] **Step 3: Implement** in `app/routers/settings.py`

Replace:
```python
    if update.openhop_api_token is not None:
        kwargs["openhop_api_token"] = update.openhop_api_token.strip()
```
with:
```python
    # Write-only: only update the token when a non-empty value is provided; a
    # blank value means "keep the current token".
    if update.openhop_api_token is not None and update.openhop_api_token.strip():
        kwargs["openhop_api_token"] = update.openhop_api_token.strip()
```

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONPATH=. uv run pytest tests/test_settings_router.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/routers/settings.py tests/test_settings_router.py
git commit -m "feat(openhop): keep stored api token when patched blank"
```

---

## Task 3: Write-only token UI

**Files:**
- Modify: `frontend/src/types.ts` (add `openhop_api_token_set`)
- Modify: `frontend/src/components/settings/OpenHopSettings.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json` (placeholder key)
- Test: `frontend/src/test/openHopSettings.test.tsx`

- [ ] **Step 1: Update/add the frontend tests.**

Replace the `prefills existing url and token from settings` test with a write-only assertion, and add an omit-when-blank test:
```tsx
  it('does not prefill the token (write-only) but prefills the url', () => {
    render(
      <OpenHopSettings
        health={health(true)}
        appSettings={appSettings({
          openhop_api_url: 'http://node:8000',
          openhop_api_token: null,
          openhop_api_token_set: true,
        } as Partial<AppSettings>)}
        onSaveAppSettings={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/URL/i)).toHaveValue('http://node:8000');
    expect(screen.getByLabelText(/token/i)).toHaveValue('');
  });

  it('omits the token on save when left blank', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <OpenHopSettings
        health={health(true)}
        appSettings={appSettings({ openhop_api_url: 'http://node:8000' })}
        onSaveAppSettings={onSave}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ openhop_api_url: 'http://node:8000' })
    );
  });
```

The existing `saves the entered url and token via onSaveAppSettings` test stays valid (a typed token is included).

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && npx vitest run src/test/openHopSettings.test.tsx`
Expected: FAIL (token currently prefills; blank save currently sends `openhop_api_token: ''`).

- [ ] **Step 3: Implement.**

In `frontend/src/types.ts`, add to the `AppSettings` interface (near `openhop_api_token`):
```ts
  openhop_api_token_set?: boolean;
```

In `OpenHopSettings.tsx`:
- Change the token state init:
```tsx
  const [token, setToken] = useState('');
```
- Replace the `save` body's `onSaveAppSettings` call:
```tsx
      const update: AppSettingsUpdate = { openhop_api_url: url.trim() };
      const trimmedToken = token.trim();
      if (trimmedToken) update.openhop_api_token = trimmedToken;
      await onSaveAppSettings(update);
      setToken('');
```
- Add a placeholder to the token `Input`:
```tsx
          placeholder={t('settings_openhop_token_placeholder')}
```

In `frontend/src/i18n/locales/{en,nl,de}.json`, add near the other `settings_openhop_*` keys:
- en: `"settings_openhop_token_placeholder": "Leave blank to keep the current token"`
- nl: `"settings_openhop_token_placeholder": "Laat leeg om het huidige token te behouden"`
- de: `"settings_openhop_token_placeholder": "Leer lassen, um das aktuelle Token zu behalten"`

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/test/openHopSettings.test.tsx && npx vitest run src/test/i18nParity.test.ts`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/components/settings/OpenHopSettings.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/openHopSettings.test.tsx
git commit -m "feat(openhop): write-only api token field in settings UI"
```

---

## Task 4: Docs + full gates

- [ ] **Step 1:** Add a `CHANGELOG-DMC-EV.md` entry (Backend + Security) noting the token is now write-only / masked in settings responses and kept when patched blank.

- [ ] **Step 2: Backend gates**
```bash
PYTHONPATH=. uv run pytest tests/test_settings_router.py tests/test_openhop_router.py tests/test_openhop_api_service.py -q
PYTHONPATH=. uv run ruff check app/models.py app/routers/settings.py tests/test_settings_router.py
PYTHONPATH=. uv run ruff format --check app/models.py app/routers/settings.py tests/test_settings_router.py
PYTHONPATH=. uv run pytest tests/ -q   # confirm 14 failed / 32 errors baseline unchanged
```

- [ ] **Step 3: Frontend gates**
```bash
cd frontend && npx tsc --noEmit && npx vitest run && npx prettier --check "src/**/*.{ts,tsx,json}" && npx eslint src && npx vite build
```

- [ ] **Step 4: Commit**
```bash
git add CHANGELOG-DMC-EV.md
git commit -m "docs(openhop): changelog for write-only api token"
```

---

## Self-Review

**Spec coverage:** mask on serialisation (Task 1), set flag (Task 1), PATCH keep-current (Task 2), write-only UI + type + i18n (Task 3), docs + gates (Task 4). **Type consistency:** `openhop_api_token_set` added to the model (Task 1) and the frontend type (Task 3); `AppSettingsUpdate` unchanged. **Placeholder scan:** none. Note the deliberate asymmetry (URL clears on blank, token is kept) is stated in the spec and asserted in `test_openhop_empty_token_kept_url_cleared`.
