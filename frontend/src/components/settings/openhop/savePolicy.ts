import { api } from '../../../api';
import type { OpenHopPolicyEngine } from '../../../types';
import type { TFn } from '../../../i18n';

/**
 * Validate a policy engine config, then persist it. Non-destructive: on a failed
 * validate or update the caller's error setter is populated and the draft is kept.
 */
export async function savePolicy(
  engine: OpenHopPolicyEngine,
  opts: { setError: (e: string | null) => void; onSaved: () => Promise<void> | void; t: TFn }
): Promise<void> {
  const { setError, onSaved, t } = opts;
  setError(null);
  try {
    const v = await api.validateOpenHopPolicy(engine);
    if (!v.success || !v.data?.valid) {
      setError(v.error ?? t('openhop_policy_invalid'));
      return;
    }
    const r = await api.updateOpenHopPolicy(engine);
    if (!r.success) {
      setError(r.error ?? t('openhop_policy_invalid'));
      return;
    }
    await onSaved();
  } catch (err) {
    setError(err instanceof Error ? err.message : t('openhop_policy_invalid'));
  }
}
