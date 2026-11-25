"""Message bookmarks: bookmark stored messages, list them, export them.

Local only: nothing is sent over RF. Bookmarked messages are kept by message
retention cleanup; deleting a message removes its bookmark (FK cascade).
"""

import csv
import io
import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.models import BookmarkEntry, BookmarkRequest
from app.repository.bookmarks import BookmarkRepository
from app.repository.messages import MessageRepository
from app.websocket import broadcast_event

logger = logging.getLogger(__name__)

router = APIRouter(tags=["bookmarks"])


def _iso(ts: int | None) -> str:
    if ts is None:
        return ""
    return datetime.fromtimestamp(ts, tz=UTC).strftime("%Y-%m-%d %H:%M:%S UTC")


def _sender(entry: BookmarkEntry) -> str:
    if entry.message.outgoing:
        return "You"
    return entry.message.sender_name or ""


def _kind(entry: BookmarkEntry) -> str:
    return "Channel" if entry.message.type == "CHAN" else "DM"


def bookmarks_to_csv(entries: list[BookmarkEntry]) -> str:
    """One row per bookmark; the csv module quotes commas, quotes and newlines."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(
        [
            "bookmarked_at",
            "received_at",
            "conversation_type",
            "conversation",
            "sender",
            "text",
            "note",
            "message_id",
        ]
    )
    for e in entries:
        writer.writerow(
            [
                _iso(e.created_at),
                _iso(e.message.received_at),
                _kind(e),
                e.conversation_name or e.message.conversation_key,
                _sender(e),
                e.message.text,
                e.note or "",
                e.message.id,
            ]
        )
    return buf.getvalue()


def bookmarks_to_markdown(entries: list[BookmarkEntry], now: int) -> str:
    """Newest bookmark first; message text as a block quote, note below it."""
    lines = [
        "# RTFM-EV bookmarks",
        "",
        f"Exported {_iso(now)}. {len(entries)} bookmark(s).",
    ]
    for e in entries:
        conversation = e.conversation_name or e.message.conversation_key
        heading = f"## {_kind(e)}: {conversation}"
        sender = _sender(e)
        lines += [
            "",
            heading,
            "",
            f"{_iso(e.message.received_at)}" + (f", {sender}" if sender else ""),
        ]
        lines.append("")
        lines += [f"> {line}" if line else ">" for line in e.message.text.splitlines() or [""]]
        if e.note:
            lines += ["", f"Note: {e.note}"]
    return "\n".join(lines) + "\n"


def _broadcast(message_id: int, msg_type: str, conversation_key: str, note: str | None, on: bool):
    broadcast_event(
        "message_bookmark",
        {
            "message_id": message_id,
            "type": msg_type,
            "conversation_key": conversation_key,
            "bookmarked": on,
            "note": note,
        },
    )


@router.get("/bookmarks", response_model=list[BookmarkEntry])
async def list_bookmarks(
    limit: int = Query(default=50, ge=1, le=200),
    before: int | None = Query(default=None, description="Cursor: created_at of last seen"),
    before_id: int | None = Query(default=None, description="Cursor: message id of last seen"),
    conversation_key: str | None = Query(default=None, description="Only this conversation"),
) -> list[BookmarkEntry]:
    """Bookmarked messages, newest bookmark first."""
    return await BookmarkRepository.list(
        limit=limit, before=before, before_id=before_id, conversation_key=conversation_key
    )


@router.get("/bookmarks/export")
async def export_bookmarks(format: Literal["md", "csv"] = Query(default="md")) -> Response:
    """Download every bookmark as Markdown or CSV."""
    entries = await BookmarkRepository.list(limit=0)
    if format == "csv":
        body = bookmarks_to_csv(entries)
        media_type = "text/csv; charset=utf-8"
    else:
        body = bookmarks_to_markdown(entries, int(datetime.now(tz=UTC).timestamp()))
        media_type = "text/markdown; charset=utf-8"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="rtfm-ev-bookmarks.{format}"'},
    )


@router.put("/messages/{message_id}/bookmark", response_model=BookmarkEntry)
async def set_bookmark(message_id: int, request: BookmarkRequest) -> BookmarkEntry:
    """Bookmark a message, or update the note on an existing bookmark."""
    entry = await BookmarkRepository.set(message_id, request.note)
    if entry is None:
        raise HTTPException(status_code=404, detail="Message not found")
    _broadcast(message_id, entry.message.type, entry.message.conversation_key, entry.note, on=True)
    return entry


@router.delete("/messages/{message_id}/bookmark")
async def remove_bookmark(message_id: int) -> dict:
    """Remove a message's bookmark. 404 when the message does not exist."""
    message = await MessageRepository.get_by_id(message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    removed = await BookmarkRepository.remove(message_id)
    if removed:
        _broadcast(message_id, message.type, message.conversation_key, None, on=False)
    return {"status": "ok", "removed": removed}
