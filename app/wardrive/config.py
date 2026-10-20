"""Owner settings served to wardrive drivers: the hashtag channels they may
decode. Only channel names leave RTFM-EV; a hashtag channel's key follows
from its name, so drivers derive it themselves. Private channel keys are
never served."""

from hashlib import sha256

from app.repository.channels import ChannelRepository
from app.repository.wardrive import WardriveConfigRepository

HASHTAG_CHANNELS = "hashtag_channels"
MAX_HASHTAG_CHANNELS = 200
# The radio's channel name field: 32 UTF-8 bytes including the leading '#'.
MAX_NAME_BYTES = 32


def hashtag_key(name: str) -> str:
    """The channel key a hashtag name derives (name hashed verbatim), upper hex."""
    return sha256(name.encode("utf-8")).digest()[:16].hex().upper()


def normalize_hashtag(name: str) -> str | None:
    """``#name`` with surrounding space and extra ``#`` removed, or None when
    empty or longer than the radio allows."""
    bare = name.strip().lstrip("#").strip()
    if not bare:
        return None
    tagged = f"#{bare}"
    if len(tagged.encode("utf-8")) > MAX_NAME_BYTES:
        return None
    return tagged


def sort_names(names: list[str]) -> list[str]:
    """Unique names, sorted case-insensitively; the spelling is kept since
    the key depends on it."""
    return sorted(set(names), key=lambda n: (n.casefold(), n))


async def default_hashtag_channels() -> list[str]:
    """The home radio's hashtag channels whose key follows from the name."""
    return sort_names(
        [
            c.name
            for c in await ChannelRepository.get_all()
            if c.is_hashtag and c.key.upper() == hashtag_key(c.name)
        ]
    )


async def owner_hashtag_channels() -> list[str] | None:
    stored = await WardriveConfigRepository.get_json(HASHTAG_CHANNELS)
    return list(stored) if isinstance(stored, list) else None


async def resolved_hashtag_channels() -> list[str]:
    """The owner's list when set, else the home radio's hashtag channels."""
    owner = await owner_hashtag_channels()
    return owner if owner is not None else await default_hashtag_channels()
