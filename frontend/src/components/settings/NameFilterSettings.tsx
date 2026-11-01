import { useEffect, useState } from 'react';

import { useT } from '../../i18n';
import type { AppSettings, AppSettingsUpdate } from '../../types';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { toast } from '../ui/sonner';

const PLACEHOLDER = 'Adriaan\\d{2,4}\nB2-\\d{2,4}';

interface NameFilterSettingsProps {
  appSettings: Pick<AppSettings, 'name_filter_patterns' | 'hide_name_filtered'>;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
}

const splitLines = (draft: string) =>
  draft
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * Regular expressions for sender names (`app/name_filter.py`). The server
 * checks them and re-checks stored messages on save, so a refused list stays in
 * the box to be corrected.
 */
export function NameFilterSettings({ appSettings, onSaveAppSettings }: NameFilterSettingsProps) {
  const t = useT();
  const saved = (appSettings.name_filter_patterns ?? []).join('\n');
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const save = async () => {
    setSaving(true);
    try {
      await onSaveAppSettings({ name_filter_patterns: splitLines(draft) });
      toast.success(t('settings_name_filter_saved'));
    } catch (err) {
      toast.error(t('settings_name_filter_save_failed'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (hide: boolean) => {
    try {
      await onSaveAppSettings({ hide_name_filtered: hide });
    } catch (err) {
      toast.error(t('settings_name_filter_save_failed'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
      });
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">{t('settings_name_filter_heading')}</h4>
      <p className="text-[0.8125rem] text-muted-foreground">{t('settings_name_filter_desc')}</p>

      <div className="flex items-start gap-3">
        <Checkbox
          id="name-filter-hide"
          checked={appSettings.hide_name_filtered ?? false}
          onCheckedChange={(checked) => void toggle(checked === true)}
          className="mt-0.5"
        />
        <Label htmlFor="name-filter-hide" className="font-normal">
          {t('settings_name_filter_enable')}
        </Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name-filter-patterns">{t('settings_name_filter_patterns_label')}</Label>
        <textarea
          id="name-filter-patterns"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono min-h-[80px]"
          placeholder={PLACEHOLDER}
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
        />
      </div>

      <Button
        variant="outline"
        className="w-full"
        disabled={saving || splitLines(draft).join('\n') === saved}
        onClick={() => void save()}
      >
        {t('settings_name_filter_save')}
      </Button>
    </div>
  );
}
