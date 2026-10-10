import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import type { ContactRouteSuggestion, ContactRouteSuggestions } from '../types';
import { formatTime } from '../utils/messageParser';
import { toast } from './ui/sonner';

type Validation = NonNullable<ContactRouteSuggestion['validation']>;

const STATUS: Record<Validation['status'], { key: string; className: string }> = {
  confirmed: { key: 'contact_route_validation_confirmed', className: 'text-success' },
  partial: { key: 'contact_route_validation_partial', className: 'text-warning' },
  // Not seen by the analyzer is missing evidence, not proof the route is dead.
  unconfirmed: {
    key: 'contact_route_validation_unconfirmed',
    className: 'text-muted-foreground',
  },
  not_checked: {
    key: 'contact_route_validation_not_checked',
    className: 'text-muted-foreground',
  },
};

const CHAIN_KEY: Record<Validation['chain'], string | null> = {
  observed: 'contact_route_chain_observed',
  speculative: 'contact_route_chain_speculative',
  unknown: 'contact_route_chain_unknown',
  not_checked: null,
};

const LAST_HOP_KEY: Record<Validation['last_hop'], string | null> = {
  two_way: 'contact_route_last_hop_two_way',
  contact_hears_hop: 'contact_route_last_hop_contact_hears_hop',
  hop_hears_contact: 'contact_route_last_hop_hop_hears_contact',
  not_seen: 'contact_route_last_hop_not_seen',
  not_checked: null,
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Routes for direct messages to a contact, built from the paths it was heard on.
 * Suggest only: a route is used only after "Use" sets it as the routing override.
 * The analyzer is asked only on request and never changes the ranking.
 */
export function ContactRouteSuggestionsSection({ publicKey }: { publicKey: string }) {
  const t = useT();
  const [data, setData] = useState<ContactRouteSuggestions | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    api
      .contactRouteSuggestions(publicKey)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  if (!data || data.suggestions.length === 0) return null;
  const host = hostOf(data.analyzer_url);

  const check = async () => {
    setChecking(true);
    try {
      const result = await api.contactRouteSuggestions(publicKey, true);
      setData(result);
      if (result.validation_error) {
        toast.error(t('contact_route_check_failed', { error: result.validation_error }));
      }
    } catch (err) {
      toast.error(
        t('contact_route_check_failed', { error: err instanceof Error ? err.message : '' })
      );
    } finally {
      setChecking(false);
    }
  };

  const use = async (suggestion: ContactRouteSuggestion) => {
    setApplying(suggestion.route);
    try {
      await api.setContactRoutingOverride(publicKey, suggestion.route);
      setData((prev) =>
        prev
          ? {
              ...prev,
              suggestions: prev.suggestions.map((s) => ({
                ...s,
                is_current: s.route === suggestion.route,
              })),
            }
          : prev
      );
      toast.success(t('contact_route_suggestion_applied'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('contact_route_suggestion_apply_failed'));
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="px-5 py-3 border-b border-border" data-testid="contact-route-suggestions">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
          {t('contact_route_suggestions')}
        </h3>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
          disabled={checking}
          onClick={() => void check()}
          title={t('contact_route_check_title', { host })}
        >
          {checking ? t('contact_route_check_busy') : t('contact_route_check')}
        </button>
      </div>
      <p className="text-xs text-muted-foreground my-1.5">
        {t('contact_route_suggestions_hint', { host })}
      </p>
      <div className="space-y-2">
        {data.suggestions.map((s) => (
          <div key={`${s.path_hash_mode}:${s.route}`} data-testid="contact-route-suggestion">
            <div className="flex justify-between items-start gap-2 text-sm">
              <span className="font-mono text-xs break-all">
                {s.path_len === 0 ? t('contact_direct_path') : s.route.split(',').join(' → ')}
              </span>
              {s.is_current ? (
                <span className="text-xs text-primary shrink-0">
                  {t('contact_route_suggestion_in_use')}
                </span>
              ) : (
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  disabled={applying !== null}
                  onClick={() => void use(s)}
                  title={t('contact_route_suggestion_use_title')}
                >
                  {t('contact_route_suggestion_use')}
                </button>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {t('contact_route_suggestion_detail', {
                score: Math.round(s.score * 100),
                heard: s.heard_count,
              })}
              {s.attempt_count > 0 &&
                ` · ${t('contact_route_suggestion_delivered', {
                  ok: s.success_count,
                  attempts: s.attempt_count,
                })}`}
              {' · '}
              {formatTime(s.last_seen)}
            </div>
            {s.validation && <ValidationLine validation={s.validation} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function ValidationLine({ validation }: { validation: Validation }) {
  const t = useT();
  const status = STATUS[validation.status];
  const chainKey = CHAIN_KEY[validation.chain];
  const lastHopKey = LAST_HOP_KEY[validation.last_hop];
  const details = [
    chainKey && t(chainKey),
    lastHopKey && t(lastHopKey),
    validation.ambiguous_hops > 0 &&
      t('contact_route_ambiguous_hops', { count: validation.ambiguous_hops }),
  ].filter(Boolean);
  return (
    <div className="text-xs" data-testid="contact-route-validation">
      <span className={status.className}>{t(status.key)}</span>
      {details.length > 0 && (
        <span className="text-muted-foreground">{` · ${details.join(' · ')}`}</span>
      )}
    </div>
  );
}
