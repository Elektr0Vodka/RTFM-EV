import { useRef, useState } from 'react';
import { useT } from '../../i18n';
import type { AppSettings, AppSettingsUpdate } from '../../types';
import { validateBrandIconDataUrl } from '../../utils/brandIcon';
import { toast } from '../ui/sonner';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export function BrandingSettings({
  appSettings,
  onSave,
}: {
  appSettings: AppSettings | null;
  onSave: (update: AppSettingsUpdate) => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(appSettings?.brand_name ?? '');
  const [hidden, setHidden] = useState(appSettings?.brand_hidden ?? false);
  const [icon, setIcon] = useState(appSettings?.brand_icon ?? '');

  const commitName = () => {
    const trimmed = name.trim().slice(0, 64);
    if (trimmed !== (appSettings?.brand_name ?? '')) {
      onSave({ brand_name: trimmed });
    }
  };

  const handleHidden = (next: boolean) => {
    setHidden(next);
    onSave({ brand_hidden: next });
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const errorKey = validateBrandIconDataUrl(dataUrl);
      if (errorKey) {
        toast.error(t(errorKey));
        return;
      }
      setIcon(dataUrl);
      onSave({ brand_icon: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const removeIcon = () => {
    setIcon('');
    onSave({ brand_icon: '' });
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_branding_heading')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_branding_description')}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="brand-name">{t('settings_branding_name_label')}</Label>
        <Input
          id="brand-name"
          value={name}
          maxLength={64}
          placeholder={t('settings_branding_name_placeholder')}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitName();
            }
          }}
        />
      </div>

      <div className="flex items-center gap-3 rounded-md border border-border/60 p-3">
        <Checkbox
          id="brand-hidden"
          checked={hidden}
          onCheckedChange={(c) => handleHidden(c === true)}
        />
        <Label htmlFor="brand-hidden">{t('settings_branding_hide_label')}</Label>
      </div>

      <div className="space-y-1.5">
        <Label>{t('settings_branding_icon_label')}</Label>
        <div className="flex items-center gap-3">
          {icon ? (
            <img
              src={icon}
              alt=""
              aria-hidden="true"
              className="h-8 w-8 rounded border border-border object-contain"
            />
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/jpeg"
            className="sr-only"
            aria-label={t('settings_branding_icon_upload')}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            {t('settings_branding_icon_upload')}
          </Button>
          {icon ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={removeIcon}
            >
              {t('settings_branding_icon_remove')}
            </Button>
          ) : null}
        </div>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_branding_icon_hint')}</p>
      </div>
    </div>
  );
}
