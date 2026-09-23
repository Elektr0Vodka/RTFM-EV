import { useEffect, useState } from 'react';

import { api } from '../api';
import { useT } from '../i18n';
import type { ReactionTargetResponse } from '../types';
import { parseSenderFromText } from '../utils/messageParser';

// A reaction's target never changes once stored, so resolve each reaction
// message once per page load. Failed lookups are not cached (retry on remount).
const cache = new Map<number, ReactionTargetResponse>();
const inflight = new Map<number, Promise<ReactionTargetResponse>>();

/** Test helper: forget resolved reaction targets. */
export function clearReactionTargetCache(): void {
  cache.clear();
  inflight.clear();
}

function resolveReactionTarget(messageId: number): Promise<ReactionTargetResponse> {
  const pending = inflight.get(messageId);
  if (pending) return pending;
  const request = api
    .getReactionTarget(messageId)
    .then((result) => {
      cache.set(messageId, result);
      return result;
    })
    .finally(() => inflight.delete(messageId));
  inflight.set(messageId, request);
  return request;
}

const SNIPPET_MAX_CHARS = 60;

/**
 * Shows which message a hash-addressed reaction points at, resolved by the
 * backend, and jumps to it on click.
 */
/** Where to look for a target we never received (the channel on an analyzer). */
export interface ReactionAnalyzerLookup {
  url: string;
  siteName: string;
}

export function ReactionTargetLink({
  messageId,
  onJump,
  analyzerLookup,
}: {
  messageId: number;
  onJump?: (messageId: number) => void;
  analyzerLookup?: ReactionAnalyzerLookup;
}) {
  const t = useT();
  const [result, setResult] = useState<ReactionTargetResponse | null>(
    () => cache.get(messageId) ?? null
  );

  useEffect(() => {
    if (cache.has(messageId)) {
      setResult(cache.get(messageId) ?? null);
      return;
    }
    let cancelled = false;
    resolveReactionTarget(messageId)
      .then((resolved) => {
        if (!cancelled) setResult(resolved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  if (!result) return null;

  const target = result.target;
  if (!target) {
    return (
      <span className="text-xs text-muted-foreground italic">
        ({t('chat_reaction_target_missing')}
        {analyzerLookup && (
          <>
            {', '}
            <a
              href={analyzerLookup.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              title={t('chat_reaction_find_on_analyzer_title', {
                site: analyzerLookup.siteName,
                sender: result.target_sender ?? '?',
              })}
            >
              {t('chat_reaction_find_on_analyzer', { site: analyzerLookup.siteName })}
            </a>
          </>
        )}
        )
      </span>
    );
  }

  const body = target.type === 'CHAN' ? parseSenderFromText(target.text).content : target.text;
  const snippet = body.length > SNIPPET_MAX_CHARS ? `${body.slice(0, SNIPPET_MAX_CHARS)}…` : body;
  const quoted = `“${snippet}”`;

  if (!onJump) {
    return <span className="text-xs text-muted-foreground">{quoted}</span>;
  }
  return (
    <button
      type="button"
      className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
      title={t('chat_reaction_jump_title')}
      onClick={() => onJump(target.id)}
    >
      {quoted}
    </button>
  );
}
