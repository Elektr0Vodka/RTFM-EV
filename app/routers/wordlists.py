import logging
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.repository import WordlistRepository
from app.wordlist_normalize import normalize_wordlist_text

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/wordlists", tags=["wordlists"])


class WordlistMeta(BaseModel):
    id: int
    name: str
    entry_count: int
    size_bytes: int
    created_at: int


class WordlistListResponse(BaseModel):
    wordlists: list[WordlistMeta]


class WordlistWordsResponse(BaseModel):
    words: list[str]


@router.get("", response_model=WordlistListResponse)
async def list_wordlists() -> WordlistListResponse:
    """List uploaded wordlist metadata (newest first)."""
    rows = await WordlistRepository.list_all()
    return WordlistListResponse(wordlists=[WordlistMeta(**row) for row in rows])


@router.post("", response_model=WordlistMeta)
async def upload_wordlist(
    name: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
) -> WordlistMeta:
    """Upload a plain-text wordlist. Server normalizes and stores it.

    Normalization conforms each line to the hashtag-room charset (see
    ``app.wordlist_normalize``). Rejects a blank name or a file that yields no
    valid entries. No entry cap is enforced.
    """
    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Wordlist name is required.")

    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")

    words = normalize_wordlist_text(text)
    if not words:
        raise HTTPException(
            status_code=400,
            detail="File contained no valid hashtag-room names after normalization.",
        )

    meta = await WordlistRepository.create(clean_name, words)
    logger.info("Uploaded wordlist '%s' with %d entries", clean_name, len(words))
    return WordlistMeta(**meta)


@router.get("/{wordlist_id}/words", response_model=WordlistWordsResponse)
async def get_wordlist_words(wordlist_id: int) -> WordlistWordsResponse:
    """Return a stored wordlist's words for the browser cracker to merge."""
    words = await WordlistRepository.read_words(wordlist_id)
    if words is None:
        raise HTTPException(status_code=404, detail="Wordlist not found.")
    return WordlistWordsResponse(words=words)


@router.delete("/{wordlist_id}", status_code=204)
async def delete_wordlist(wordlist_id: int) -> None:
    """Delete a wordlist row and its on-disk file."""
    deleted = await WordlistRepository.delete(wordlist_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Wordlist not found.")
