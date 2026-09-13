import pytest

from app.repository import MentionSoundRepository


@pytest.mark.asyncio
async def test_set_get_delete_roundtrip(test_db):
    assert await MentionSoundRepository.get() is None

    await MentionSoundRepository.set(b"\x00\x01\x02", "audio/mpeg", "chime.mp3")
    got = await MentionSoundRepository.get()
    assert got is not None
    assert got["data"] == b"\x00\x01\x02"
    assert got["content_type"] == "audio/mpeg"
    assert got["filename"] == "chime.mp3"
    assert got["size_bytes"] == 3
    assert isinstance(got["updated_at"], int)

    # set() replaces (single row).
    await MentionSoundRepository.set(b"\x09", "audio/wav", "again.wav")
    got2 = await MentionSoundRepository.get()
    assert got2 is not None
    assert got2["data"] == b"\x09"
    assert got2["filename"] == "again.wav"

    await MentionSoundRepository.delete()
    assert await MentionSoundRepository.get() is None
