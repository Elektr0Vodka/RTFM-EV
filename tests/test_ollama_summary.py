"""Tests for Ollama unread channel summaries."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.models import Message
from app.repository import AppSettingsRepository, ChannelRepository, MessageRepository
from app.routers.channels import summarize_channel_unread
from app.routers.settings import AppSettingsUpdate, update_settings
from app.services.ollama_summary import (
    MAX_MESSAGES_FOR_SUMMARY,
    OllamaConfigError,
    format_messages_for_prompt,
    normalize_ollama_base_url,
    summary_cache,
)


@pytest.fixture(autouse=True)
def _empty_summary_cache():
    """The cache is process-wide and every test database starts its ids at 1."""
    summary_cache.clear()
    yield
    summary_cache.clear()


def _message(text: str, *, outgoing: bool = False, sender: str | None = None) -> Message:
    return Message(
        id=1,
        type="CHAN",
        conversation_key="AA" * 16,
        text=text,
        received_at=1,
        outgoing=outgoing,
        sender_name=sender,
    )


def test_normalize_ollama_base_url():
    assert normalize_ollama_base_url("") == "http://localhost:11434"
    assert normalize_ollama_base_url("  http://host:11434/  ") == "http://host:11434"
    assert normalize_ollama_base_url("https://ollama.lan") == "https://ollama.lan"


@pytest.mark.parametrize("bad", ["file:///etc/passwd", "ftp://host", "localhost:11434", "http://"])
def test_normalize_ollama_base_url_rejects_untrusted_urls(bad: str):
    with pytest.raises(OllamaConfigError):
        normalize_ollama_base_url(bad)


def test_format_messages_for_prompt_attributes_senders():
    transcript = format_messages_for_prompt(
        [
            _message("meeting at noon", sender="Alice"),
            _message("bring snacks", outgoing=True),
            _message("   ", sender="Bob"),
            _message("no name here"),
        ]
    )
    assert transcript == "Alice: meeting at noon\nYou: bring snacks\nno name here"


def test_format_messages_for_prompt_does_not_repeat_the_stored_sender_prefix():
    """Stored channel text is "Sender: body"; the transcript must not say the name twice."""
    transcript = format_messages_for_prompt(
        [
            _message("Alice: net at noon?", sender="Alice"),
            _message("MyNode: on my way", outgoing=True, sender="MyNode"),
            _message("Bob: Alice: was quoted", sender="Bob"),
        ]
    )
    assert transcript.splitlines() == [
        "Alice: net at noon?",
        "You: on my way",
        "Bob: Alice: was quoted",
    ]


@pytest.mark.asyncio
async def test_settings_persist_and_validate_ollama_fields(test_db):
    result = await update_settings(
        AppSettingsUpdate(
            ollama_enabled=True,
            ollama_base_url="http://ollama.local:11434/",
            ollama_model="  llama3.2  ",
        )
    )
    assert result.ollama_enabled is True
    assert result.ollama_base_url == "http://ollama.local:11434"
    assert result.ollama_model == "llama3.2"
    assert (await AppSettingsRepository.get()).ollama_model == "llama3.2"

    with pytest.raises(HTTPException) as excinfo:
        await update_settings(AppSettingsUpdate(ollama_base_url="file:///etc/passwd"))
    assert excinfo.value.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("enabled", "model"),
    [(False, "phi3:mini"), (True, ""), (True, "   ")],
)
async def test_summarize_returns_no_summary_when_unconfigured(test_db, enabled: bool, model: str):
    key = "DD" * 16
    await ChannelRepository.upsert(key=key, name="#off")
    await AppSettingsRepository.update(ollama_enabled=enabled, ollama_model=model)

    result = await summarize_channel_unread(key, after=0)

    assert result.summary is None
    assert result.message_count == 0
    assert "not configured" in (result.reason or "")


@pytest.mark.asyncio
async def test_summarize_returns_no_summary_without_unread_messages(test_db):
    key = "EE" * 16
    await ChannelRepository.upsert(key=key, name="#quiet")
    await AppSettingsRepository.update(ollama_enabled=True, ollama_model="phi3:mini")

    result = await summarize_channel_unread(key, after=0)

    assert result.summary is None
    assert result.reason == "No unread messages"


@pytest.mark.asyncio
async def test_summarize_only_covers_messages_after_the_read_boundary(test_db):
    key = "CC" * 16
    await ChannelRepository.upsert(key=key, name="#mesh")
    await AppSettingsRepository.update(
        ollama_enabled=True,
        ollama_base_url="http://localhost:11434",
        ollama_model="phi3:mini",
    )
    for text, received_at in (("old news", 500), ("meeting at noon", 1000), ("snacks", 1001)):
        await MessageRepository.create(
            msg_type="CHAN",
            conversation_key=key,
            text=text,
            received_at=received_at,
            outgoing=False,
        )

    with patch(
        "app.routers.channels.summarize_channel_messages",
        new_callable=AsyncMock,
        return_value="Meeting at noon; bring snacks.",
    ) as mock_summarize:
        result = await summarize_channel_unread(key, after=900)

    assert result.summary == "Meeting at noon; bring snacks."
    assert result.message_count == 2
    kwargs = mock_summarize.await_args.kwargs
    assert kwargs["model"] == "phi3:mini"
    assert kwargs["channel_name"] == "#mesh"
    assert [m.text for m in kwargs["messages"]] == ["meeting at noon", "snacks"]


@pytest.mark.asyncio
async def test_summarize_reports_an_unreachable_server_without_leaking_details(test_db):
    key = "FF" * 16
    await ChannelRepository.upsert(key=key, name="#down")
    await AppSettingsRepository.update(
        ollama_enabled=True,
        ollama_base_url="http://ollama.invalid:11434",
        ollama_model="phi3:mini",
    )
    await MessageRepository.create(
        msg_type="CHAN",
        conversation_key=key,
        text="anyone there?",
        received_at=1000,
        outgoing=False,
    )

    with patch(
        "app.routers.channels.summarize_channel_messages",
        new_callable=AsyncMock,
        side_effect=RuntimeError("connect to http://ollama.invalid:11434 refused"),
    ):
        result = await summarize_channel_unread(key, after=0)

    assert result.summary is None
    assert result.message_count == 1
    assert result.reason == "Could not reach the Ollama server"
    assert "ollama.invalid" not in (result.reason or "")


@pytest.mark.asyncio
async def test_summarize_skips_malformed_messages_when_they_are_hidden(test_db):
    key = "AB" * 16
    await ChannelRepository.upsert(key=key, name="#spam")
    await AppSettingsRepository.update(
        ollama_enabled=True, ollama_model="phi3:mini", hide_malformed=True
    )
    await MessageRepository.create(
        msg_type="CHAN", conversation_key=key, text="real question", received_at=1000
    )
    await MessageRepository.create(
        msg_type="CHAN",
        conversation_key=key,
        text="gibberish",
        received_at=1001,
        malformed=True,
    )

    with patch(
        "app.routers.channels.summarize_channel_messages",
        new_callable=AsyncMock,
        return_value="One question.",
    ) as mock_summarize:
        result = await summarize_channel_unread(key, after=0)

    assert result.message_count == 1
    assert [m.text for m in mock_summarize.await_args.kwargs["messages"]] == ["real question"]


@pytest.mark.asyncio
async def test_summarize_skips_spam_flagged_messages_when_they_are_hidden(test_db):
    key = "AC" * 16
    await ChannelRepository.upsert(key=key, name="#flood")
    await AppSettingsRepository.update(ollama_enabled=True, ollama_model="phi3:mini")
    await MessageRepository.create(
        msg_type="CHAN", conversation_key=key, text="real question", received_at=1000
    )
    advert = await MessageRepository.create(
        msg_type="CHAN", conversation_key=key, text="cheap radios", received_at=1001
    )
    assert advert is not None
    await MessageRepository.set_spam([advert])

    with patch(
        "app.routers.channels.summarize_channel_messages",
        new_callable=AsyncMock,
        return_value="A question and an advert.",
    ) as mock_summarize:
        shown = await summarize_channel_unread(key, after=0)
    assert shown.message_count == 2

    await AppSettingsRepository.update(hide_spam=True)
    with patch(
        "app.routers.channels.summarize_channel_messages",
        new_callable=AsyncMock,
        return_value="One question.",
    ) as mock_summarize:
        hidden = await summarize_channel_unread(key, after=0)

    assert hidden.message_count == 1
    assert [m.text for m in mock_summarize.await_args.kwargs["messages"]] == ["real question"]


@pytest.mark.asyncio
async def test_summarize_takes_the_newest_messages_when_more_are_unread_than_fit(test_db):
    key = "A1" * 16
    await ChannelRepository.upsert(key=key, name="#busy")
    await AppSettingsRepository.update(ollama_enabled=True, ollama_model="phi3:mini")
    total = MAX_MESSAGES_FOR_SUMMARY + 3
    for i in range(total):
        await MessageRepository.create(
            msg_type="CHAN", conversation_key=key, text=f"msg {i}", received_at=1000 + i
        )

    with patch(
        "app.routers.channels.summarize_channel_messages",
        new_callable=AsyncMock,
        return_value="Busy.",
    ) as mock_summarize:
        result = await summarize_channel_unread(key, after=0)

    assert result.message_count == MAX_MESSAGES_FOR_SUMMARY
    # The newest ones, still oldest first so the transcript reads in order.
    assert [m.text for m in mock_summarize.await_args.kwargs["messages"]] == [
        f"msg {i}" for i in range(3, total)
    ]


@pytest.mark.asyncio
async def test_summarize_skips_messages_hidden_by_the_hop_size_filter(test_db):
    key = "A2" * 16
    await ChannelRepository.upsert(key=key, name="#hops")
    await AppSettingsRepository.update(
        ollama_enabled=True, ollama_model="phi3:mini", hidden_hop_widths=[1]
    )
    # Two hops of one byte each: hidden by the filter.
    await MessageRepository.create(
        msg_type="CHAN",
        conversation_key=key,
        text="one byte hops",
        received_at=1000,
        path="aabb",
        path_len=2,
    )
    # Two hops of two bytes each: shown.
    await MessageRepository.create(
        msg_type="CHAN",
        conversation_key=key,
        text="two byte hops",
        received_at=1001,
        path="aabbccdd",
        path_len=2,
    )
    # Our own message is never hidden, whatever its path.
    await MessageRepository.create(
        msg_type="CHAN",
        conversation_key=key,
        text="mine",
        received_at=1002,
        path="aabb",
        path_len=2,
        outgoing=True,
    )

    with patch(
        "app.routers.channels.summarize_channel_messages",
        new_callable=AsyncMock,
        return_value="Hops.",
    ) as mock_summarize:
        result = await summarize_channel_unread(key, after=0)

    assert result.message_count == 2
    assert [m.text for m in mock_summarize.await_args.kwargs["messages"]] == [
        "two byte hops",
        "mine",
    ]


@pytest.mark.asyncio
async def test_summarize_does_not_ask_again_for_the_same_messages(test_db):
    key = "A3" * 16
    await ChannelRepository.upsert(key=key, name="#again")
    await AppSettingsRepository.update(ollama_enabled=True, ollama_model="phi3:mini")
    await MessageRepository.create(
        msg_type="CHAN", conversation_key=key, text="first", received_at=1000
    )

    with patch(
        "app.routers.channels.summarize_channel_messages",
        new_callable=AsyncMock,
        side_effect=["Summary one.", "Summary two."],
    ) as mock_summarize:
        first = await summarize_channel_unread(key, after=0)
        again = await summarize_channel_unread(key, after=0)
        assert mock_summarize.await_count == 1
        assert first.summary == again.summary == "Summary one."
        assert again.message_count == 1

        # A new message changes what is asked, so the model is asked again.
        await MessageRepository.create(
            msg_type="CHAN", conversation_key=key, text="second", received_at=1001
        )
        newer = await summarize_channel_unread(key, after=0)

    assert mock_summarize.await_count == 2
    assert newer.summary == "Summary two."
    assert newer.message_count == 2


@pytest.mark.asyncio
async def test_summarize_asks_again_when_the_model_changes(test_db):
    key = "A4" * 16
    await ChannelRepository.upsert(key=key, name="#model")
    await AppSettingsRepository.update(ollama_enabled=True, ollama_model="phi3:mini")
    await MessageRepository.create(
        msg_type="CHAN", conversation_key=key, text="hello", received_at=1000
    )

    with patch(
        "app.routers.channels.summarize_channel_messages",
        new_callable=AsyncMock,
        side_effect=["From phi.", "From llama."],
    ) as mock_summarize:
        await summarize_channel_unread(key, after=0)
        await AppSettingsRepository.update(ollama_model="llama3.2")
        result = await summarize_channel_unread(key, after=0)

    assert mock_summarize.await_count == 2
    assert result.summary == "From llama."


@pytest.mark.asyncio
async def test_summarize_does_not_keep_a_failed_attempt(test_db):
    key = "A5" * 16
    await ChannelRepository.upsert(key=key, name="#retry")
    await AppSettingsRepository.update(ollama_enabled=True, ollama_model="phi3:mini")
    await MessageRepository.create(
        msg_type="CHAN", conversation_key=key, text="hello", received_at=1000
    )

    with patch(
        "app.routers.channels.summarize_channel_messages",
        new_callable=AsyncMock,
        side_effect=[RuntimeError("down"), "Back up."],
    ) as mock_summarize:
        failed = await summarize_channel_unread(key, after=0)
        retried = await summarize_channel_unread(key, after=0)

    assert failed.summary is None
    assert retried.summary == "Back up."
    assert mock_summarize.await_count == 2


@pytest.mark.asyncio
async def test_summarize_shares_one_request_between_simultaneous_callers(test_db):
    key = "A6" * 16
    await ChannelRepository.upsert(key=key, name="#tabs")
    await AppSettingsRepository.update(ollama_enabled=True, ollama_model="phi3:mini")
    await MessageRepository.create(
        msg_type="CHAN", conversation_key=key, text="hello", received_at=1000
    )
    release = asyncio.Event()
    calls = 0

    async def _slow_summary(**_kwargs):
        nonlocal calls
        calls += 1
        await release.wait()
        return "One answer."

    with patch("app.routers.channels.summarize_channel_messages", _slow_summary):
        first = asyncio.create_task(summarize_channel_unread(key, after=0))
        second = asyncio.create_task(summarize_channel_unread(key, after=0))
        await asyncio.sleep(0.05)
        release.set()
        results = await asyncio.gather(first, second)

    assert calls == 1
    assert [r.summary for r in results] == ["One answer.", "One answer."]


@pytest.mark.asyncio
async def test_summarize_channel_messages_posts_a_chat_request_and_returns_the_reply():
    from app.services import ollama_summary

    seen = {}

    class _Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"message": {"content": "  Alice asked about noon.  "}}

    class _Client:
        def __init__(self, *args, **kwargs):
            seen["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json):
            seen["url"] = url
            seen["payload"] = json
            return _Response()

    with patch.object(ollama_summary.httpx, "AsyncClient", _Client):
        summary = await ollama_summary.summarize_channel_messages(
            base_url="http://ollama.lan:11434/",
            model="phi3:mini",
            channel_name="#mesh",
            messages=[_message("meeting at noon?", sender="Alice")],
        )

    assert summary == "Alice asked about noon."
    assert seen["url"] == "http://ollama.lan:11434/api/chat"
    assert seen["payload"]["model"] == "phi3:mini"
    assert seen["payload"]["stream"] is False
    assert "Alice: meeting at noon?" in seen["payload"]["messages"][1]["content"]


@pytest.mark.asyncio
async def test_summarize_channel_messages_rejects_an_empty_reply():
    from app.services import ollama_summary

    class _Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"message": {"content": "   "}}

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json):
            return _Response()

    with (
        patch.object(ollama_summary.httpx, "AsyncClient", _Client),
        pytest.raises(RuntimeError),
    ):
        await ollama_summary.summarize_channel_messages(
            base_url="",
            model="phi3:mini",
            channel_name="#mesh",
            messages=[_message("hello", sender="Alice")],
        )
