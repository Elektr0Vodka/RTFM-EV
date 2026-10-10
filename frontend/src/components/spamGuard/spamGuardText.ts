import type { TFn } from '../../i18n';
import type { SpamActivityEntry, SpamBlock } from '../../types';

/** Blocks with an expiry this far out are "kept until removed" (the backend adds 10 years). */
const PERMANENT_SECONDS = 5 * 365 * 86400;

/** "12 min", "3 h", "2 d": a coarse duration for expiry and age columns. */
export function formatDuration(seconds: number, t: TFn): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return t('spam_duration_seconds', { count: s });
  if (s < 90 * 60) return t('spam_duration_minutes', { count: Math.round(s / 60) });
  if (s < 36 * 3600) return t('spam_duration_hours', { count: Math.round(s / 3600) });
  return t('spam_duration_days', { count: Math.round(s / 86400) });
}

export function formatExpiry(block: SpamBlock, nowSeconds: number, t: TFn): string {
  const left = block.expires - nowSeconds;
  if (left > PERMANENT_SECONDS) return t('spam_expiry_permanent');
  return t('spam_expiry_in', { time: formatDuration(left, t) });
}

/** What a block holds back, in words. */
export function blockLabel(block: SpamBlock, t: TFn): string {
  switch (block.kind) {
    case 'hop': {
      const hop = String(block.value);
      switch (block.mode) {
        case 'exact_paths':
          return t('spam_block_hop_exact', { hop });
        case 'contains':
          return t('spam_block_hop_any', { hop });
        case 'starts_at':
          return t('spam_block_hop_starts', { hop });
        default:
          return t('spam_block_hop_known', { hop });
      }
    }
    case 'suffix': {
      const route = Array.isArray(block.value) ? block.value.join(' > ') : '';
      return route ? t('spam_block_suffix', { route }) : t('spam_block_suffix_direct');
    }
    case 'links':
      return t('spam_block_links');
    case 'lockdown':
      return t('spam_block_lockdown');
    case 'words':
      return t('spam_block_words', {
        words: Array.isArray(block.value) ? block.value.join(', ') : '',
      });
    default:
      return t('spam_block_text', { text: String(block.value ?? '') });
  }
}

const REASON_KEYS: Record<string, string> = {
  campaign: 'spam_reason_campaign',
  campaign_changed: 'spam_reason_campaign_changed',
  campaign_variant: 'spam_reason_campaign_variant',
  duplicate: 'spam_reason_duplicate',
  resent_changed: 'spam_reason_resent_changed',
  hop_random: 'spam_reason_hop_random',
  hop_new: 'spam_reason_hop_new',
  hop_campaign: 'spam_reason_hop_campaign',
  hop_random_long: 'spam_reason_hop_random_long',
  rotation: 'spam_reason_rotation',
  rotation_linked: 'spam_reason_rotation_linked',
  links_always: 'spam_reason_links_always',
  links_campaign: 'spam_reason_links_campaign',
  lockdown: 'spam_reason_lockdown',
  manual: 'spam_reason_manual',
  marked_spam: 'spam_reason_marked_spam',
};

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/** Why a block exists: the backend sends a code plus numbers, worded here. */
export function reasonLabel(block: SpamBlock, t: TFn): string {
  const key = REASON_KEYS[block.reason];
  if (!key) return block.reason;
  const detail = block.detail ?? {};
  return t(key, {
    count: num(detail.count),
    senders: num(detail.senders),
    origins: num(detail.origins),
    minutes: num(detail.minutes),
  });
}

const ACTIVITY_KEYS: Record<string, string> = {
  block_started: 'spam_activity_block_started',
  block_expired: 'spam_activity_block_expired',
  block_removed: 'spam_activity_block_removed',
  path_learnt: 'spam_activity_path_learnt',
  origin_allowed: 'spam_activity_origin_allowed',
  trusted_new_place: 'spam_activity_trusted_new_place',
  not_spam: 'spam_activity_not_spam',
  lockdown_ended: 'spam_activity_lockdown_ended',
  cleared_auto: 'spam_activity_cleared_auto',
};

function str(value: unknown): string {
  if (Array.isArray(value)) return value.join(' > ');
  return value == null ? '' : String(value);
}

export function activityLabel(entry: SpamActivityEntry, t: TFn): string {
  const key = ACTIVITY_KEYS[entry.event];
  if (!key) return entry.event;
  return t(key, {
    key: str(entry.key),
    kind: str(entry.kind),
    value: str(entry.value),
    path: str(entry.path),
    hop: str(entry.hop),
    sender: str(entry.sender),
    hits: num(entry.hits),
  });
}

/** Seconds of airtime as "1.2 s" / "3 min". */
export function formatAirtime(ms: number, t: TFn): string {
  if (ms < 60_000) return t('spam_airtime_seconds', { value: (ms / 1000).toFixed(1) });
  return t('spam_duration_minutes', { count: Math.round(ms / 60_000) });
}
