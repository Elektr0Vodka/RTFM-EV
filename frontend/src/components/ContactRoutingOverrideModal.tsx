import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import type { Contact } from '../types';
import {
  formatForcedRouteSummary,
  formatLearnedRouteSummary,
  formatRoutingOverrideInput,
} from '../utils/pathUtils';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useT } from '../i18n';

interface ContactRoutingOverrideModalProps {
  open: boolean;
  onClose: () => void;
  contact: Contact;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}

export function ContactRoutingOverrideModal({
  open,
  onClose,
  contact,
  onSaved,
  onError,
}: ContactRoutingOverrideModalProps) {
  const t = useT();
  const [route, setRoute] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setRoute(formatRoutingOverrideInput(contact));
    setError(null);
  }, [contact, open]);

  const learnedRouteSummary = useMemo(() => formatLearnedRouteSummary(contact), [contact]);
  const forcedRouteSummary = useMemo(() => formatForcedRouteSummary(contact), [contact]);

  const saveRoute = async (value: string) => {
    setSaving(true);
    setError(null);
    try {
      await api.setContactRoutingOverride(contact.public_key, value);
      onSaved(
        value.trim() === '' ? t('path_override_toast_cleared') : t('path_override_toast_updated')
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('path_override_error_fallback');
      setError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('path_override_title')}</DialogTitle>
          <DialogDescription>{t('path_override_description')}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveRoute(route);
          }}
        >
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="font-medium">{contact.name || contact.public_key.slice(0, 12)}</div>
            <div className="mt-1 text-muted-foreground">
              {t('path_current_learned_route_label')} {learnedRouteSummary}
            </div>
            {forcedRouteSummary && (
              <div className="mt-1 text-destructive">
                {t('path_current_forced_route_label')} {forcedRouteSummary}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="routing-override-input">
              {t('path_override_forced_route_field_label')}
            </Label>
            <Input
              id="routing-override-input"
              value={route}
              onChange={(event) => setRoute(event.target.value)}
              placeholder={t('path_override_placeholder')}
              autoFocus
              disabled={saving}
            />
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>{t('path_override_helper_hop_ids')}</p>
              <p>{t('path_override_helper_retry_note')}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void saveRoute('-1')}
                disabled={saving}
              >
                {t('path_override_force_flood_button')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void saveRoute('0')}
                disabled={saving}
              >
                {t('path_override_force_direct_button')}
              </Button>
            </div>
            <Button type="submit" className="w-full" disabled={saving || route.trim().length === 0}>
              {saving
                ? t('settings_radio_saving')
                : t('path_override_force_route_button', {
                    route: route.trim() === '' ? t('path_override_custom_label') : route.trim(),
                  })}
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              {t('common_cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void saveRoute('')}
              disabled={saving}
            >
              {t('path_override_clear_button')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
