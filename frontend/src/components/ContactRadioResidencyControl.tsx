import { useCallback, useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { api, isAbortError } from '../api';
import { useT } from '../i18n';
import type { Contact, RadioPolicy, RadioResidencyReason } from '../types';
import { toast } from './ui/sonner';

const POLICIES: RadioPolicy[] = ['auto', 'pinned', 'excluded'];

const POLICY_LABEL_KEY: Record<RadioPolicy, string> = {
  auto: 'contact_radio_policy_auto',
  pinned: 'contact_radio_policy_pinned',
  excluded: 'contact_radio_policy_excluded',
};

const POLICY_HINT_KEY: Record<RadioPolicy, string> = {
  auto: 'contact_radio_policy_auto_hint',
  pinned: 'contact_radio_policy_pinned_hint',
  excluded: 'contact_radio_policy_excluded_hint',
};

const REASON_KEY: Record<RadioResidencyReason, string> = {
  pinned: 'contact_radio_reason_pinned',
  favorite: 'contact_radio_reason_favorite',
  'recent-dm': 'contact_radio_reason_recent_dm',
  'recent-advert': 'contact_radio_reason_recent_advert',
};

/**
 * Per-contact radio residency control: shows whether the contact currently
 * occupies the radio (derived, never a stored flag) and lets the operator set
 * the policy (auto / pin / app-only). Residency is refetched after a change
 * and whenever the contact changes.
 */
export function ContactRadioResidencyControl({ contact }: { contact: Contact }) {
  const t = useT();
  const publicKey = contact.public_key;
  const [reason, setReason] = useState<RadioResidencyReason | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const residency = await api.getRadioResidency(signal);
        const match = residency.find((r) => r.public_key.toLowerCase() === publicKey.toLowerCase());
        setReason(match ? match.reason : null);
      } catch (err) {
        if (!isAbortError(err)) setReason(null);
      }
    },
    [publicKey]
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const setPolicy = useCallback(
    async (policy: RadioPolicy) => {
      if (policy === contact.radio_policy || saving) return;
      setSaving(true);
      try {
        await api.setContactRadioPolicy(publicKey, policy);
        await refresh();
      } catch {
        toast.error(t('contact_radio_policy_error'));
      } finally {
        setSaving(false);
      }
    },
    [contact.radio_policy, publicKey, refresh, saving, t]
  );

  const onRadio = reason !== null;

  return (
    <div className="px-5 py-3 border-b border-border space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Radio
          className={`h-4.5 w-4.5 ${onRadio ? 'text-primary' : 'text-muted-foreground'}`}
          aria-hidden="true"
        />
        <span className="font-medium">{t('contact_radio_residency_label')}</span>
        <span className={`ml-auto text-xs ${onRadio ? 'text-primary' : 'text-muted-foreground'}`}>
          {onRadio
            ? t('contact_radio_on_via', { reason: t(REASON_KEY[reason]) })
            : t('contact_radio_off')}
        </span>
      </div>
      <div className="flex gap-1" role="group" aria-label={t('contact_radio_residency_label')}>
        {POLICIES.map((policy) => {
          const active = contact.radio_policy === policy;
          return (
            <button
              key={policy}
              type="button"
              disabled={saving}
              aria-pressed={active}
              title={t(POLICY_HINT_KEY[policy])}
              onClick={() => void setPolicy(policy)}
              className={`flex-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(POLICY_LABEL_KEY[policy])}
            </button>
          );
        })}
      </div>
    </div>
  );
}
