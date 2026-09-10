import { useEffect, useState } from 'react';

import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Label } from './ui/label';
import { useT, type TFn } from '../i18n';

function pathHashModeLabels(t: TFn): Record<number, string> {
  return {
    0: t('path_hash_override_1byte_label'),
    1: t('path_hash_override_2byte_label'),
    2: t('path_hash_override_3byte_label'),
  };
}

interface ChannelPathHashModeOverrideModalProps {
  open: boolean;
  onClose: () => void;
  channelName: string;
  currentOverride: number | null;
  radioDefault: number;
  onSetOverride: (value: number | null) => void;
}

export function ChannelPathHashModeOverrideModal({
  open,
  onClose,
  channelName,
  currentOverride,
  radioDefault,
  onSetOverride,
}: ChannelPathHashModeOverrideModalProps) {
  const t = useT();
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(currentOverride);
    }
  }, [currentOverride, open]);

  const pathHashModeLabelMap = pathHashModeLabels(t);
  const radioDefaultLabel = pathHashModeLabelMap[radioDefault] ?? `${radioDefault}`;

  const options: { value: number | null; label: string; description: string }[] = [
    {
      value: null,
      label: t('path_hash_override_radio_default_option_label', { label: radioDefaultLabel }),
      description: t('path_hash_override_radio_default_option_desc'),
    },
    {
      value: 0,
      label: t('path_hash_override_1byte_option_label'),
      description: t('path_hash_override_1byte_desc'),
    },
    {
      value: 1,
      label: t('path_hash_override_2byte_option_label'),
      description: t('path_hash_override_2byte_desc'),
    },
    {
      value: 2,
      label: t('path_hash_override_3byte_option_label'),
      description: t('path_hash_override_3byte_desc'),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('path_hash_override_title')}</DialogTitle>
          <DialogDescription>{t('path_hash_override_description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="font-medium">{channelName}</div>
            <div className="mt-1 text-muted-foreground">
              {t('path_hash_override_current_label')}{' '}
              {currentOverride != null
                ? (pathHashModeLabelMap[currentOverride] ??
                  t('path_hash_override_mode_fallback', { n: currentOverride }))
                : t('path_hash_override_none_radio_default', { label: radioDefaultLabel })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('path_hash_override_field_label')}</Label>
            <div className="space-y-1.5">
              {options.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    selected === opt.value
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border hover:bg-accent'
                  }`}
                  onClick={() => setSelected(opt.value)}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:block sm:space-x-0">
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              onSetOverride(selected);
              onClose();
            }}
          >
            {selected == null
              ? t('path_hash_override_use_default_button', { channel: channelName })
              : t('path_hash_override_use_selected_button', {
                  label: pathHashModeLabelMap[selected],
                  channel: channelName,
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
