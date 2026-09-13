import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';

const MODES = ['forward', 'monitor', 'no_tx'] as const;
type Mode = (typeof MODES)[number];

/** Switch the OpenHop node's operating mode (forward / monitor / no_tx). */
export function ConfigModeCard({ currentMode }: { currentMode?: string }) {
  const t = useT();
  const [mode, setMode] = useState<string | undefined>(currentMode);
  const [busy, setBusy] = useState(false);

  const label = (m: Mode) =>
    m === 'forward'
      ? t('openhop_config_mode_forward')
      : m === 'monitor'
        ? t('openhop_config_mode_monitor')
        : t('openhop_config_mode_no_tx');

  const choose = async (m: Mode) => {
    setBusy(true);
    try {
      const res = await api.setOpenHopMode(m);
      if (res.success) {
        setMode(res.mode ?? m);
        toast.success(t('openhop_config_mode_saved', { mode: label(m) }));
      } else {
        toast.error(res.error || t('openhop_config_mode_failed'));
      }
    } catch {
      toast.error(t('openhop_config_mode_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{t('openhop_config_mode_title')}</h4>
      <div className="flex gap-2">
        {MODES.map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={mode === m ? 'default' : 'outline'}
            disabled={busy}
            aria-pressed={mode === m}
            onClick={() => void choose(m)}
          >
            {label(m)}
          </Button>
        ))}
      </div>
    </section>
  );
}
