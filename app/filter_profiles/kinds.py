"""What a kind of filter profile provides, and the refusals of the library.

A kind is the bridge between a stored payload and the running feature it
belongs to. The library (``app/services/filter_profiles.py``) knows nothing
about the feature; the kind knows nothing about storage or files.
"""

from __future__ import annotations

from typing import Any, Protocol


class ProfileError(Exception):
    """A request the filter library refuses.

    ``code`` is what the API answers; the UI words it in the user's language.
    ``message`` follows the code (``code: message``) where the code alone does
    not say what is wrong, as for a file that fails validation.
    """

    def __init__(self, code: str, message: str = "", *, status: int = 400) -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code
        self.message = message
        self.status = status

    @property
    def detail(self) -> str:
        return str(self)


class ProfileKind(Protocol):
    """One kind of profile. ``kind`` is the value stored in ``filter_profiles.kind``."""

    kind: str

    def validate(self, payload: dict[str, Any]) -> dict[str, Any]:
        """The payload in its stored form. Raises ValueError naming the problem."""
        ...

    async def capture(self) -> dict[str, Any]:
        """The live values of the feature, as a payload."""
        ...

    async def apply(self, payload: dict[str, Any], *, confirmed: bool) -> None:
        """Make the live values those of the payload.

        Raises ProfileError for a refusal, ValueError for a payload that does
        not validate. ``confirmed`` is the user's yes to a change the kind
        does not make silently.
        """
        ...

    async def matches(self, payload: dict[str, Any]) -> bool:
        """Whether the live values are those of the payload."""
        ...

    async def changes(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """What applying would change: ``{"key", "from", "to"}`` per value."""
        ...
