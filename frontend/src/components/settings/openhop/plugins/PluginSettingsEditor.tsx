import { useEffect, useState } from 'react';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';

interface Props {
  id: string;
}

/** Raw JSON editor for a plugin's config object (validate-before-save). */
export function PluginSettingsEditor({ id }: Props) {
  const t = useT();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getOpenHopPluginConfig(id)
      .then((res) => {
        if (!active) return;
        const config = res.config ?? {};
        setText(JSON.stringify(config, null, 2));
      })
      .catch(() => {
        if (active) setError(t('openhop_plugin_settings_load_failed'));
      });
    return () => {
      active = false;
    };
  }, [id, t]);

  const onChange = (value: string) => {
    setText(value);
    setSaved(false);
    try {
      JSON.parse(value || '{}');
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  };

  const save = async (restart: boolean) => {
    setError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text || '{}') as Record<string, unknown>;
    } catch {
      setInvalid(true);
      return;
    }
    const res = await api.setOpenHopPluginConfig(id, parsed, restart);
    if (res.success) {
      setSaved(true);
    } else {
      setError(res.error ?? t('openhop_plugin_settings_invalid_json'));
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={10}
        className="w-full rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-snug"
      />
      {invalid && (
        <p className="text-xs text-destructive">{t('openhop_plugin_settings_invalid_json')}</p>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={invalid} onClick={() => void save(false)}>
          {t('openhop_plugin_settings_save')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={invalid}
          onClick={() => void save(true)}
        >
          {t('openhop_plugin_settings_save_restart')}
        </Button>
        {saved && !error && (
          <span className="text-xs text-muted-foreground">
            {t('openhop_plugin_settings_saved')}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
