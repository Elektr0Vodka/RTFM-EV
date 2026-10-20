"""Statistics about spam, malformed and duplicate channel messages and bots.

Feeds the Mesh Health "Spam & bots" tab. Read-only: counts over stored channel
messages (``app/services/filter_stats.py``). Nothing here transmits or writes.
"""

import asyncio

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.repository import AppSettingsRepository
from app.repository.filter_stats import FilterStatsRepository
from app.services.filter_stats import (
    ChannelInfo,
    aggregate_filter_stats,
    channel_is_public,
    clean_policy_rules,
)
from app.services.spam_guard import spam_guard
from app.version_info import get_app_build_info

router = APIRouter(prefix="/filter-stats", tags=["filter-stats"])

MAX_BUCKETS = 200
MAX_ROWS = 500
# The tab asks for 30 days at most. Every row of the window is read into
# memory, so a request for "everything" is refused instead of served.
MAX_WINDOW_DAYS = 92


class FilterCounts(BaseModel):
    messages: int = 0
    spam: int = 0
    malformed: int = 0
    duplicate: int = 0
    bot_now: int = Field(default=0, description="Messages whose sender is on a bot list today")
    flagged: int = Field(default=0, description="Messages with at least one of the four flags")


class FilterWindow(BaseModel):
    start_ts: int
    end_ts: int
    bucket_seconds: int
    channel: str | None = Field(default=None, description="Channel key, or null for all")


class FilterTotals(FilterCounts):
    malformed_text: int = 0
    malformed_clock: int = 0
    malformed_both: int = 0
    malformed_unknown: int = Field(default=0, description="Flagged, cause not recorded")
    bot_flagged: int = Field(default=0, description="Sender was listed when the message arrived")
    bot_listed_later: int = 0
    bot_no_longer_listed: int = 0
    multi_flag: int = Field(default=0, description="Messages with two or more flags")


class FilterBucket(FilterCounts):
    bucket_ts: int


class FilterSender(FilterCounts):
    name: str = Field(description="Sender name; empty when the message has none")
    public_key: str | None = None
    bot_flagged: int = 0
    bot_lists: list[str] = Field(default_factory=list)
    channels: int = Field(default=0, description="Number of channels the sender wrote in")
    first_seen: int
    last_seen: int


class FilterChannel(FilterCounts):
    key: str
    name: str
    public: bool = Field(description="Public channel, or a #name whose key derives from it")
    protected: bool = Field(default=False, description="A Spam Guard protected channel")


class FilterSource(FilterCounts):
    hop: str = Field(description="First relay on the path, or DIRECT")
    last_seen: int


class FilterBlockCount(BaseModel):
    source: str
    count: int


class FilterOutcomes(BaseModel):
    analysed: int = 0
    clean: int = 0
    stopped: int = 0
    let_through: int = 0
    held: int = 0
    enforced: int = Field(default=0, description="Stopped while Protect really withheld")
    not_enforced: int = Field(default=0, description="Stopped in Monitor: would have been")
    stop_rate: int | None = None
    blocks: list[FilterBlockCount] = Field(default_factory=list)
    confirmed: int = 0
    missed: int = 0
    false_positive: int = 0
    flagged_later: int = 0
    not_recorded: int = 0


class FilterPolicyRule(BaseModel):
    action: str
    rule: str | None = Field(default=None, description="Null for a drop by the default action")
    packets: int


class FilterStatsResponse(BaseModel):
    window: FilterWindow
    totals: FilterTotals
    series: list[FilterBucket]
    senders: list[FilterSender]
    senders_truncated: bool
    channels: list[FilterChannel]
    sources: list[FilterSource]
    sources_truncated: bool
    filters: FilterOutcomes
    policy_rules: list[FilterPolicyRule]
    spam_guard_enabled: bool
    bot_lists_enabled: bool
    app_version: str


@router.get("", response_model=FilterStatsResponse)
async def get_filter_stats(
    start_ts: int,
    end_ts: int,
    channel: str | None = Query(default=None, description="Limit to one channel key"),
    buckets: int = 48,
    limit: int = 200,
) -> FilterStatsResponse:
    """Spam, malformed, duplicate and bot statistics for ``[start_ts, end_ts)``."""
    if end_ts <= start_ts:
        raise HTTPException(status_code=400, detail="end_ts must be greater than start_ts")
    if end_ts - start_ts > MAX_WINDOW_DAYS * 86400:
        raise HTTPException(
            status_code=400, detail=f"The window can be {MAX_WINDOW_DAYS} days at most"
        )
    bucket_count = max(1, min(buckets, MAX_BUCKETS))
    row_limit = max(1, min(limit, MAX_ROWS))
    channel_key = channel.upper() if channel else None

    rows = await FilterStatsRepository.window_rows(start_ts, end_ts, channel_key)
    bot_names, bot_keys = await FilterStatsRepository.bot_attribution()
    channels = {
        key: ChannelInfo(name=name, public=channel_is_public(key, name))
        for key, name in (await FilterStatsRepository.channel_names()).items()
    }
    # A rule name can hold a channel key, and a private channel's key is its secret.
    policy_rules = clean_policy_rules(
        await FilterStatsRepository.policy_rules(start_ts, end_ts), channels
    )
    settings = await AppSettingsRepository.get()
    await spam_guard.ensure_loaded()
    protected = {c.key for c in spam_guard.config.channels}

    # A month of a busy channel is many rows: keep the counting off the event loop.
    report = await asyncio.to_thread(
        aggregate_filter_stats,
        rows,
        start_ts=start_ts,
        end_ts=end_ts,
        buckets=bucket_count,
        limit=row_limit,
        bot_names=bot_names,
        bot_keys=bot_keys,
        channels=channels,
        policy_rules=policy_rules,
        channel=channel_key,
        protected=protected,
    )
    return FilterStatsResponse(
        **report,
        spam_guard_enabled=settings.spam_guard_enabled is True,
        bot_lists_enabled=bool(bot_names or bot_keys),
        app_version=get_app_build_info().version,
    )
