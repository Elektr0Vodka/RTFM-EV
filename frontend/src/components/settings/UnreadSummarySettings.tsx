import { useEffect, useState } from 'react';

import { useT } from '../../i18n';
import type { AppSettings, AppSettingsUpdate } from '../../types';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface UnreadSummarySettingsProps {
  appSettings: Pick<AppSettings, 'ollama_enabled' | 'ollama_base_url' | 'ollama_model'>;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
}

/**
 * Ollama unread-summary settings. The RTFM-EV server calls Ollama, so the
 * address must be reachable from the server, not from this browser. Off until
 * the switch is on and a model is named.
 */
export function UnreadSummarySettings({
  appSettings,
  onSaveAppSettings,
}: UnreadSummarySettingsProps) {
  const t = useT();
  const [urlDraft, setUrlDraft] = useState(appSettings.ollama_base_url);
  const [modelDraft, setModelDraft] = useState(appSettings.ollama_model);

  useEffect(() => {
    setUrlDraft(appSettings.ollama_base_url);
    setModelDraft(appSettings.ollama_model);
  }, [appSettings.ollama_base_url, appSettings.ollama_model]);

  // The parent reports a failed save itself; here only the field is put back.
  const save = (update: AppSettingsUpdate, revert: () => void) => {
    onSaveAppSettings(update).catch(revert);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold tracking-tight">{t('settings_ollama_heading')}</h3>
      <p className="text-[0.8125rem] text-muted-foreground">{t('settings_ollama_description')}</p>

      <div className="flex items-start gap-3">
        <Checkbox
          id="ollama-enabled"
          checked={appSettings.ollama_enabled}
          onCheckedChange={(checked) => save({ ollama_enabled: checked === true }, () => {})}
          className="mt-0.5"
        />
        <Label htmlFor="ollama-enabled" className="font-normal">
          {t('settings_ollama_enable_label')}
        </Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ollama-base-url">{t('settings_ollama_url_label')}</Label>
        <Input
          id="ollama-base-url"
          value={urlDraft}
          spellCheck={false}
          placeholder="http://localhost:11434"
          onChange={(e) => setUrlDraft(e.target.value)}
          onBlur={() => {
            const next = urlDraft.trim();
            if (next === appSettings.ollama_base_url) return;
            save({ ollama_base_url: next }, () => setUrlDraft(appSettings.ollama_base_url));
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ollama-model">{t('settings_ollama_model_label')}</Label>
        <Input
          id="ollama-model"
          value={modelDraft}
          spellCheck={false}
          placeholder="phi3:mini"
          onChange={(e) => setModelDraft(e.target.value)}
          onBlur={() => {
            const next = modelDraft.trim();
            if (next === appSettings.ollama_model) return;
            save({ ollama_model: next }, () => setModelDraft(appSettings.ollama_model));
          }}
        />
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_ollama_model_help')}</p>
      </div>
    </div>
  );
}
