import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_upload_get_delete_mention_sound(test_db, client):
    # No sound yet -> 404.
    r = await client.get("/api/settings/mention-sound")
    assert r.status_code == 404

    # Upload a small valid file.
    files = {"file": ("chime.mp3", b"ID3fakebody-small", "audio/mpeg")}
    r = await client.post("/api/settings/mention-sound", files=files)
    assert r.status_code == 200
    body = r.json()
    assert body["filename"] == "chime.mp3"
    assert body["content_type"] == "audio/mpeg"

    # choice flips to 'custom'.
    assert (await AppSettingsRepository.get()).mention_sound_choice == "custom"
    # metadata surfaces in the settings GET (not the blob).
    settings = await AppSettingsRepository.get()
    assert settings.mention_sound_custom is not None
    assert settings.mention_sound_custom.filename == "chime.mp3"

    # GET streams it back.
    r = await client.get("/api/settings/mention-sound")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert r.content == b"ID3fakebody-small"

    # Oversize rejected.
    big = {"file": ("big.mp3", b"x" * (256 * 1024 + 1), "audio/mpeg")}
    r = await client.post("/api/settings/mention-sound", files=big)
    assert r.status_code == 413

    # Wrong type rejected.
    bad = {"file": ("note.txt", b"hello", "text/plain")}
    r = await client.post("/api/settings/mention-sound", files=bad)
    assert r.status_code == 415

    # DELETE clears and resets choice to a preset.
    r = await client.delete("/api/settings/mention-sound")
    assert r.status_code == 204
    assert (await AppSettingsRepository.get()).mention_sound_choice == "beep"
    r = await client.get("/api/settings/mention-sound")
    assert r.status_code == 404
