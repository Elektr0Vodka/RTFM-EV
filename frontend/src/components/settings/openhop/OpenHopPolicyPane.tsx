import { useEffect, useState } from 'react';
import { api } from '../../../api';
import type {
  AppSettings,
  AppSettingsUpdate,
  HealthStatus,
  OpenHopPolicyDoc,
  OpenHopPolicyEngine,
} from '../../../types';
import { useT } from '../../../i18n';
import { Button } from '../../ui/button';
import { OpenHopPolicyEngineCard } from './OpenHopPolicyEngineCard';
import { OpenHopPolicyGroups } from './OpenHopPolicyGroups';
import { OpenHopPolicyRules } from './OpenHopPolicyRules';
import { savePolicy } from './savePolicy';

interface Props {
  health: HealthStatus | null;
  appSettings: AppSettings;
  onSaveAppSettings: (u: AppSettingsUpdate) => Promise<void>;
}

/**
 * Detection-gated OpenHop policy pane: engine toggle + default action, named
 * groups/entries, and filter rules. Renders nothing for non-OpenHop nodes and
 * prompts to configure management when the API url/token are unset.
 */
export function OpenHopPolicyPane({ health }: Props) {
  const t = useT();
  const isOpenHop = health?.radio_device_info?.is_openhop ?? false;
  const [doc, setDoc] = useState<OpenHopPolicyDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [saved, setSaved] = useState(false);

  const reload = async () => {
    setError(null);
    try {
      const res = await api.getOpenHopPolicy();
      if (res.success && res.data) {
        setDoc(res.data);
        setNotConfigured(false);
      } else {
        setNotConfigured(true);
      }
    } catch {
      setNotConfigured(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpenHop) void reload();
  }, [isOpenHop]);

  if (!isOpenHop) return null;
  if (loading) return null;
  if (notConfigured) {
    return <p className="text-xs text-muted-foreground">{t('openhop_policy_configure_first')}</p>;
  }
  if (!doc) {
    return <p className="text-xs text-muted-foreground">{t('openhop_policy_load_failed')}</p>;
  }

  const engine = doc.policy_engine;
  const setEngine = (next: OpenHopPolicyEngine) => setDoc({ ...doc, policy_engine: next });
  const onSaved = async () => {
    setSaved(true);
    await reload();
  };

  return (
    <div className="space-y-6">
      <OpenHopPolicyEngineCard engine={engine} onChange={setEngine} />
      <OpenHopPolicyGroups doc={doc} onChanged={reload} setError={setError} />
      <OpenHopPolicyRules engine={engine} onChange={setEngine} />
      <div className="flex items-center gap-2">
        <Button type="button" onClick={() => void savePolicy(engine, { setError, onSaved, t })}>
          {t('openhop_policy_save')}
        </Button>
        {saved && !error && (
          <span className="text-xs text-muted-foreground">{t('openhop_policy_saved')}</span>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
